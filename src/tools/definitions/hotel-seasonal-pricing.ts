/**
 * Hotel Seasonal Pricing Tool
 *
 * Calculates room prices based on seasonal rates
 */

import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';
import { getDatabase } from '@/infrastructure/database.js';
import {
  SeasonalPriceSchema,
  RoomTypeSchema,
  getSeasonForDate,
  calculateStayPrice,
} from '@/verticals/hotels/seasonal-pricing.js';

const logger = createLogger({ name: 'hotel-seasonal-pricing' });

// ─── Schemas ───────────────────────────────────────────────────

const inputSchema = z.object({
  projectId: z.string().describe('Project ID (hotel)'),
  checkIn: z.string().datetime().describe('Check-in date (ISO 8601)'),
  checkOut: z.string().datetime().describe('Check-out date (ISO 8601)'),
  roomTypeId: z.string().optional().describe('Specific room type ID (optional)'),
});

const outputSchema = z.object({
  success: z.boolean(),
  season: z.enum(['low', 'medium', 'high']),
  checkIn: z.string(),
  checkOut: z.string(),
  nights: z.number(),
  rooms: z.array(
    z.object({
      roomTypeId: z.string(),
      roomName: z.string(),
      pricePerNight: z.number(),
      totalPrice: z.number(),
      minStay: z.number(),
      meetsMinStay: z.boolean(),
    })
  ),
});

// ─── Tool Factory ──────────────────────────────────────────────

export function createHotelSeasonalPricingTool(): ExecutableTool {
  return {
    id: 'hotel-seasonal-pricing',
    name: 'Calculate Hotel Seasonal Pricing',
    description:
      'Calculate room prices based on check-in/check-out dates and seasonal rates (low/medium/high season). Returns price per night and total for all or specific room types.',
    category: 'hotels',
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    inputSchema,
    outputSchema,

    async execute(input: unknown, context: ExecutionContext): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return err(new ToolExecutionError('hotel-seasonal-pricing', 'Invalid input', parsed.error));
      }
      const { projectId, checkIn, checkOut, roomTypeId } = parsed.data;

      try {
        if (projectId !== context.projectId) {
          return err(new ToolExecutionError('hotel-seasonal-pricing', 'Cannot get pricing for different project'));
        }

        const project = await getDatabase().client.project.findUnique({
          where: { id: projectId },
        });

        if (!project) {
          return err(new ToolExecutionError('hotel-seasonal-pricing', `Project ${projectId} not found`));
        }

        const config = project.configJson as Record<string, unknown>;
        const hotelConfig = (config['hotel'] ?? {}) as Record<string, unknown>;

        const roomTypes = ((hotelConfig['roomTypes'] ?? []) as unknown[]).map((r) =>
          RoomTypeSchema.parse(r)
        );
        const prices = ((hotelConfig['seasonalPrices'] ?? []) as unknown[]).map((p) =>
          SeasonalPriceSchema.parse(p)
        );

        if (roomTypes.length === 0) {
          return err(new ToolExecutionError('hotel-seasonal-pricing', 'No room types configured for this hotel'));
        }

        const season = getSeasonForDate(new Date(checkIn));
        const checkInDate = new Date(checkIn);
        const checkOutDate = new Date(checkOut);
        const nights = Math.ceil(
          (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (nights <= 0) {
          return err(new ToolExecutionError('hotel-seasonal-pricing', 'Check-out must be after check-in'));
        }

        const relevantRooms = roomTypeId
          ? roomTypes.filter((r) => r.id === roomTypeId)
          : roomTypes;

        if (relevantRooms.length === 0) {
          return err(new ToolExecutionError('hotel-seasonal-pricing', `Room type ${roomTypeId ?? 'unknown'} not found`));
        }

        const rooms = relevantRooms.map((room) => {
          const pricing = calculateStayPrice(prices, room.id, checkIn, checkOut);

          if (!pricing) {
            return {
              roomTypeId: room.id,
              roomName: room.name,
              pricePerNight: 0,
              totalPrice: 0,
              minStay: 1,
              meetsMinStay: false,
            };
          }

          return {
            roomTypeId: room.id,
            roomName: room.name,
            pricePerNight: pricing.pricePerNight,
            totalPrice: pricing.total,
            minStay: pricing.minStay,
            meetsMinStay: pricing.meetsMinStay,
          };
        });

        logger.info('Seasonal pricing calculated', {
          component: 'hotel-seasonal-pricing',
          projectId,
          season,
          nights,
          roomCount: rooms.length,
        });

        return ok({
          success: true,
          output: { success: true, season, checkIn, checkOut, nights, rooms },
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        logger.error('Seasonal pricing failed', {
          component: 'hotel-seasonal-pricing',
          error,
        });
        return err(new ToolExecutionError(
          'hotel-seasonal-pricing',
          'Pricing calculation failed',
          error instanceof Error ? error : undefined
        ));
      }
    },

    dryRun(input: unknown): Promise<Result<ToolResult, NexusError>> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return Promise.resolve(err(new ToolExecutionError('hotel-seasonal-pricing', 'Invalid input', parsed.error)));
      }

      const season = getSeasonForDate(new Date(parsed.data.checkIn));
      const checkInDate = new Date(parsed.data.checkIn);
      const checkOutDate = new Date(parsed.data.checkOut);
      const nights = Math.ceil(
        (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      return Promise.resolve(ok({
        success: true,
        output: {
          success: true,
          season,
          checkIn: parsed.data.checkIn,
          checkOut: parsed.data.checkOut,
          nights,
          rooms: [{
            roomTypeId: 'standard',
            roomName: 'Standard Room',
            pricePerNight: 5000,
            totalPrice: 5000 * nights,
            minStay: 1,
            meetsMinStay: true,
          }],
        },
        durationMs: 0,
      }));
    },
  };
}
