/**
 * Hotel Seasonal Pricing Tool
 *
 * Calculates room prices based on seasonal rates
 */

import { z } from 'zod';
import type { ExecutableTool } from '../registry/types.js';
import type { ExecutionContext } from '../../core/types.js';
import { NexusError } from '../../core/errors.js';
import { prisma } from '../../infrastructure/database.js';
import {
  SeasonalPriceSchema,
  RoomTypeSchema,
  getSeasonForDate,
  calculateStayPrice,
  getPricedRooms,
} from '../../verticals/hotels/seasonal-pricing.js';

// ─── Tool Definition ────────────────────────────────────────────

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

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

// ─── Tool Implementation ────────────────────────────────────────

async function execute(input: Input, context: ExecutionContext): Promise<Output> {
  const { projectId, checkIn, checkOut, roomTypeId } = input;

  // Validate project access
  if (projectId !== context.projectId) {
    throw new NexusError(
      'TOOL_EXECUTION_ERROR',
      'Cannot get pricing for different project'
    );
  }

  // Get project config
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new NexusError('TOOL_EXECUTION_ERROR', `Project ${projectId} not found`);
  }

  const config = project.configJson as Record<string, unknown>;
  const hotelConfig = (config.hotel as Record<string, unknown>) || {};

  // Get room types and prices
  const roomTypes = ((hotelConfig.roomTypes as unknown[]) || []).map((r) =>
    RoomTypeSchema.parse(r)
  );
  const prices = ((hotelConfig.seasonalPrices as unknown[]) || []).map((p) =>
    SeasonalPriceSchema.parse(p)
  );

  if (roomTypes.length === 0) {
    throw new NexusError(
      'TOOL_EXECUTION_ERROR',
      'No room types configured for this hotel'
    );
  }

  // Calculate season and nights
  const season = getSeasonForDate(new Date(checkIn));
  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  const nights = Math.ceil(
    (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (nights <= 0) {
    throw new NexusError(
      'TOOL_EXECUTION_ERROR',
      'Check-out must be after check-in'
    );
  }

  // Filter room types if specific one requested
  const relevantRooms = roomTypeId
    ? roomTypes.filter((r) => r.id === roomTypeId)
    : roomTypes;

  if (relevantRooms.length === 0) {
    throw new NexusError('TOOL_EXECUTION_ERROR', `Room type ${roomTypeId} not found`);
  }

  // Calculate pricing for each room
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

  context.logger.info('Seasonal pricing calculated', {
    projectId,
    season,
    nights,
    roomCount: rooms.length,
  });

  return {
    success: true,
    season,
    checkIn,
    checkOut,
    nights,
    rooms,
  };
}

async function dryRun(input: Input): Promise<Output> {
  const season = getSeasonForDate(new Date(input.checkIn));
  const checkInDate = new Date(input.checkIn);
  const checkOutDate = new Date(input.checkOut);
  const nights = Math.ceil(
    (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  return {
    success: true,
    season,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    nights,
    rooms: [
      {
        roomTypeId: 'standard',
        roomName: 'Standard Room',
        pricePerNight: 5000,
        totalPrice: 5000 * nights,
        minStay: 1,
        meetsMinStay: true,
      },
    ],
  };
}

// ─── Tool Export ────────────────────────────────────────────────

export const hotelSeasonalPricingTool: ExecutableTool = {
  id: 'hotel-seasonal-pricing',
  name: 'Calculate Hotel Seasonal Pricing',
  description:
    'Calculate room prices based on check-in/check-out dates and seasonal rates (low/medium/high season). Returns price per night and total for all or specific room types.',
  inputSchema,
  outputSchema,
  riskLevel: 'low',
  requiresApproval: false,
  tags: ['hotels', 'pricing', 'reservations'],
  execute,
  dryRun,
};
