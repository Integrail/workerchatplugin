# Backend Implementation TODO

## Overview
The voice plugin now sends all conversation messages to the Everworker backend for persistence. Implement the following backend methods to receive and store conversation logs.

---

## When DDP vs REST is Used

The plugin automatically selects the connection adapter based on the endpoint URL:

- **DDP (Meteor WebSocket)**: When endpoint starts with `ws://` or `wss://`
- **REST (HTTP)**: When endpoint starts with `http://` or `https://`

**Code location:** `src/core/EverworkerVoicePlugin.ts:121`

```typescript
const isDDPEndpoint = this.config.endpoint.startsWith('ws');
```

---

## 1. DDP Method (Meteor)

### Method Name
```javascript
'voice.logConversationMessage'
```

### Parameters
```javascript
[data, jwtToken]
```

Where:
- `data` - The conversation log entry (see payload format below)
- `jwtToken` - JWT authentication token (string | undefined)

### Implementation Example

```javascript
import { Meteor } from 'meteor/meteor';

Meteor.methods({
  'voice.logConversationMessage': async function(data, jwtToken) {
    // 1. Validate JWT token if provided
    if (jwtToken) {
      // Your JWT validation logic here
      const userId = validateJWT(jwtToken);
      if (!userId) {
        throw new Meteor.Error('unauthorized', 'Invalid JWT token');
      }
    }

    // 2. Extract user IP address from connection
    const userIp = this.connection?.clientAddress || 'unknown';

    // 3. Validate required fields
    if (!data.workerId || !data.sessionId || !data.message) {
      throw new Meteor.Error('invalid-data', 'Missing required fields');
    }

    // 4. Store in database
    await ConversationLogs.insertAsync({
      workerId: data.workerId,
      sessionId: data.sessionId,
      userIp: userIp,
      messageId: data.message.id,
      messageType: data.message.type,
      content: data.message.content,
      timestamp: new Date(data.message.timestamp),
      source: data.message.source,
      createdAt: new Date()
    });

    console.log(`[Voice] Logged message for session ${data.sessionId}, IP: ${userIp}`);
  }
});
```

### Authentication
- JWT token is passed as the **second parameter**
- Access via: `jwtToken` argument
- Validate using your existing JWT validation logic

---

## 2. REST Endpoint

### Endpoint
```
POST /api/v1/voice/log-message
```

### Headers
```
Authorization: Bearer {jwtToken}
Content-Type: application/json
```

### Implementation Example

```javascript
app.post('/api/v1/voice/log-message', async (req, res) => {
  try {
    // 1. Validate JWT token from Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const userId = validateJWT(token);
      if (!userId) {
        return res.status(401).json({ error: 'Invalid JWT token' });
      }
    }

    // 2. Extract user IP address from request
    const userIp = req.ip ||
                   req.headers['x-forwarded-for'] ||
                   req.connection.remoteAddress ||
                   'unknown';

    // 3. Validate request body
    const { workerId, sessionId, message } = req.body;
    if (!workerId || !sessionId || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 4. Store in database
    await ConversationLogs.insert({
      workerId: workerId,
      sessionId: sessionId,
      userIp: userIp,
      messageId: message.id,
      messageType: message.type,
      content: message.content,
      timestamp: new Date(message.timestamp),
      source: message.source,
      createdAt: new Date()
    });

    console.log(`[Voice] Logged message for session ${sessionId}, IP: ${userIp}`);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Voice] Error logging message:', error);
    res.status(500).json({ error: error.message });
  }
});
```

### Authentication
- JWT token is in **Authorization header** (`Bearer {token}`)
- Access via: `req.headers.authorization`
- Parse: `authHeader.replace('Bearer ', '')`

---

## 3. Payload Format

Both methods receive the same data payload:

### JSON Structure
```json
{
  "workerId": "worker-123",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "message": {
    "id": "1699564789123-abc123xyz",
    "type": "user",
    "content": "Hello, how can you help me?",
    "timestamp": "2025-10-28T12:34:56.789Z",
    "source": "voice"
  }
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `workerId` | string | The Everworker agent/worker ID |
| `sessionId` | string | UUID v4 - unique per conversation session |
| `message.id` | string | Unique message identifier |
| `message.type` | string | `"user"` or `"assistant"` |
| `message.content` | string | The message text (or transcription if voice) |
| `message.timestamp` | string (ISO 8601) | When the message was created |
| `message.source` | string | `"voice"` or `"text"` |

### Additional Fields (Backend Should Add)

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `userIp` | string | Request metadata | Extract from connection/request |
| `createdAt` | Date | Server timestamp | When logged to database |

---

## 4. Database Schema Recommendation

```javascript
ConversationLogs = new Mongo.Collection('conversation_logs');

// Suggested schema
{
  workerId: String,          // Index this
  sessionId: String,         // Index this for querying conversations
  userIp: String,            // For analytics/security
  messageId: String,         // Unique message ID
  messageType: String,       // 'user' or 'assistant'
  content: String,           // Message text
  timestamp: Date,           // Message creation time (client-side)
  source: String,            // 'voice' or 'text'
  createdAt: Date,           // Server logging time
}

// Indexes
ConversationLogs.createIndex({ sessionId: 1, timestamp: 1 });
ConversationLogs.createIndex({ workerId: 1, createdAt: -1 });
ConversationLogs.createIndex({ userIp: 1 });
```

---

## 5. Testing

### Test with DDP (WebSocket endpoint):
```javascript
// Plugin config
endpoint: 'wss://your-server.com'

// Expected call
Meteor method: 'voice.logConversationMessage'
Parameters: [data, jwtToken]
```

### Test with REST (HTTP endpoint):
```javascript
// Plugin config
endpoint: 'https://your-server.com'

// Expected request
POST https://your-server.com/api/v1/voice/log-message
Headers: { Authorization: 'Bearer {token}', Content-Type: 'application/json' }
Body: { workerId, sessionId, message }
```

---

## 6. Important Notes

### JWT Token Handling
- ✅ **DDP**: JWT passed as 2nd parameter to Meteor method
- ✅ **REST**: JWT included in Authorization header
- Both methods receive JWT automatically if configured in plugin

### Error Handling
- The plugin uses **fire-and-forget** pattern
- Failed logs are **logged to console but don't throw**
- Conversation continues even if backend is unavailable
- This prevents backend issues from breaking user experience

### Timing
- Messages are logged **after** they appear in UI
- Logging happens **asynchronously** (non-blocking)
- User sees instant response, backend receives shortly after

### Session Lifecycle
- `sessionId` generated when user clicks "Start Session"
- All messages in that session share the same `sessionId`
- `sessionId` cleared when user clicks "End Session"
- New session = new `sessionId`

---

## 7. Verification Checklist

Backend implementation complete when:

- [ ] DDP method `voice.logConversationMessage` exists and accepts (data, jwtToken)
- [ ] REST endpoint `/api/v1/voice/log-message` exists and accepts POST requests
- [ ] Both methods validate JWT token from their respective sources
- [ ] Both methods extract user IP address
- [ ] Both methods store logs in database
- [ ] Database has `conversation_logs` collection/table
- [ ] Proper indexes created for efficient querying
- [ ] Test message logged successfully when session is active
- [ ] Verify IP address is captured correctly
- [ ] Verify sessionId groups messages from same conversation

---

## 8. Optional Enhancements

Consider adding:

1. **Session metadata endpoint**:
   ```javascript
   'voice.logSessionStart' / POST /api/v1/voice/log-session-start
   // Log when session starts with metadata
   ```

2. **Query endpoint**:
   ```javascript
   'voice.getConversationHistory' / GET /api/v1/voice/conversations/{sessionId}
   // Retrieve conversation by sessionId
   ```

3. **Analytics endpoint**:
   ```javascript
   'voice.getSessionStats' / GET /api/v1/voice/stats
   // Get usage statistics per worker
   ```

---

## Implementation Priority

1. **CRITICAL**: Implement `voice.logConversationMessage` (DDP) and `/api/v1/voice/log-message` (REST)
2. **IMPORTANT**: Set up database schema and indexes
3. **NICE TO HAVE**: Add session metadata and query endpoints

The plugin is ready and will start logging as soon as backend methods are implemented!
