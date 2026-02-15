#!/bin/bash

# WhatsApp Webhook Test Script
# Usage: ./scripts/test-whatsapp.sh [text|image|verify]

set -e

API_URL="${API_URL:-http://localhost:3000}"
WEBHOOK_PATH="/api/v1/webhooks/whatsapp"
VERIFY_TOKEN="${WHATSAPP_WEBHOOK_VERIFY_TOKEN:-test-verify-token}"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_test() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}📱 Testing: $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Test webhook verification (GET)
test_verify() {
    print_test "Webhook Verification (GET)"
    
    echo "Request:"
    echo "  GET ${API_URL}${WEBHOOK_PATH}"
    echo "  Params: hub.mode=subscribe, hub.verify_token=..., hub.challenge=test_challenge"
    echo ""
    
    RESPONSE=$(curl -s "${API_URL}${WEBHOOK_PATH}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=test_challenge")
    
    echo "Response:"
    echo "  $RESPONSE"
    echo ""
    
    if [ "$RESPONSE" == "test_challenge" ]; then
        print_success "Webhook verification passed"
    else
        print_error "Webhook verification failed"
        exit 1
    fi
}

# Test text message (POST)
test_text() {
    print_test "Incoming Text Message (POST)"
    
    PAYLOAD='{
      "object": "whatsapp_business_account",
      "entry": [{
        "id": "entry-id",
        "changes": [{
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "+1234567890",
              "phone_number_id": "test-phone-id"
            },
            "contacts": [{
              "profile": { "name": "Test User" },
              "wa_id": "5491132766709"
            }],
            "messages": [{
              "from": "5491132766709",
              "id": "msg_'$(date +%s)'",
              "timestamp": "'$(date +%s)'",
              "type": "text",
              "text": { "body": "Hello, agent! This is a test message." }
            }]
          },
          "field": "messages"
        }]
      }]
    }'
    
    echo "Request:"
    echo "  POST ${API_URL}${WEBHOOK_PATH}"
    echo "  Content-Type: application/json"
    echo ""
    echo "Payload:"
    echo "$PAYLOAD" | jq .
    echo ""
    
    RESPONSE=$(curl -s -X POST "${API_URL}${WEBHOOK_PATH}" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD")
    
    echo "Response:"
    echo "  $RESPONSE"
    echo ""
    
    if echo "$RESPONSE" | grep -q '"ok":true'; then
        print_success "Text message webhook accepted"
        print_warning "Check server logs to verify agent processing"
    else
        print_error "Text message webhook failed"
        exit 1
    fi
}

# Test image message (POST)
test_image() {
    print_test "Incoming Image Message (POST)"
    
    PAYLOAD='{
      "object": "whatsapp_business_account",
      "entry": [{
        "id": "entry-id",
        "changes": [{
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "+1234567890",
              "phone_number_id": "test-phone-id"
            },
            "contacts": [{
              "profile": { "name": "Image Sender" },
              "wa_id": "5491132766710"
            }],
            "messages": [{
              "from": "5491132766710",
              "id": "msg_img_'$(date +%s)'",
              "timestamp": "'$(date +%s)'",
              "type": "image",
              "image": {
                "id": "media_abc123",
                "mime_type": "image/jpeg",
                "caption": "What do you think about this image?"
              }
            }]
          },
          "field": "messages"
        }]
      }]
    }'
    
    echo "Request:"
    echo "  POST ${API_URL}${WEBHOOK_PATH}"
    echo "  Content-Type: application/json"
    echo ""
    echo "Payload:"
    echo "$PAYLOAD" | jq .
    echo ""
    
    RESPONSE=$(curl -s -X POST "${API_URL}${WEBHOOK_PATH}" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD")
    
    echo "Response:"
    echo "  $RESPONSE"
    echo ""
    
    if echo "$RESPONSE" | grep -q '"ok":true'; then
        print_success "Image message webhook accepted"
        print_warning "Check server logs to verify agent processing"
    else
        print_error "Image message webhook failed"
        exit 1
    fi
}

# Test health endpoint
test_health() {
    print_test "Channel Health Check"
    
    echo "Request:"
    echo "  GET ${API_URL}${WEBHOOK_PATH/whatsapp/health}"
    echo ""
    
    RESPONSE=$(curl -s "${API_URL}${WEBHOOK_PATH/whatsapp/health}")
    
    echo "Response:"
    echo "$RESPONSE" | jq .
    echo ""
    
    if echo "$RESPONSE" | grep -q '"whatsapp"'; then
        print_success "WhatsApp channel is registered"
    else
        print_warning "WhatsApp channel not found in health check"
    fi
}

# Main
case "${1:-all}" in
    verify)
        test_verify
        ;;
    text)
        test_text
        ;;
    image)
        test_image
        ;;
    health)
        test_health
        ;;
    all)
        test_health
        echo ""
        test_verify
        echo ""
        test_text
        echo ""
        test_image
        echo ""
        print_success "All tests completed!"
        ;;
    *)
        echo "Usage: $0 [verify|text|image|health|all]"
        echo ""
        echo "Commands:"
        echo "  verify  - Test webhook verification (GET)"
        echo "  text    - Test text message webhook (POST)"
        echo "  image   - Test image message webhook (POST)"
        echo "  health  - Test channel health endpoint"
        echo "  all     - Run all tests (default)"
        echo ""
        echo "Environment:"
        echo "  API_URL - Base URL (default: http://localhost:3000)"
        echo "  WHATSAPP_WEBHOOK_VERIFY_TOKEN - Verify token"
        exit 1
        ;;
esac
