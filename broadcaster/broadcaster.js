const os = require('os');
const { connect, StringCodec } = require('nats');

const NATS_URL = process.env.NATS_URL || 'nats://my-nats:4222';
const QUEUE_GROUP = process.env.QUEUE_GROUP || 'broadcaster-workers';
const POD_NAME = os.hostname();

// External chat configuration (choose Telegram or Slack)
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Log only (for staging)
const LOG_ONLY = process.env.LOG_ONLY === 'true';

const sc = StringCodec();

async function forwardToChat(eventData) {

  const textMessage_ = `[Broadcaster: ${POD_NAME}] Todo ${eventData.action}: #${eventData.todo.id} "${eventData.todo.content}" (done : ${eventData.todo.done})`;

  // In staging, only log the message and do not forward to external services
  if (LOG_ONLY) {
    console.log(`[${new Date().toISOString()}] [STAGING LOG-ONLY] ${textMessage_}`);
    return;
  }

  const statusVerb = eventData.action === 'created'
    ? 'created'
    : `marked as ${eventData.todo.done ? 'DONE' : 'UNDONE'}`;

  const textMessage = `[Broadcaster: ${POD_NAME}] A task was ${statusVerb}:\n` +
    `ID: #${eventData.todo.id}\n` +
    `Task: "${eventData.todo.content}"\n` +
    `Done: ${eventData.todo.done}`;

  // Option A: Forward to Slack Incoming Webhook
  if (SLACK_WEBHOOK_URL) {
    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textMessage })
    });
    if (!res.ok) {
      throw new Error(`Slack webhook failed with status ${res.status}`);
    }
    console.log(`[${new Date().toISOString()}] [INFO] ${POD_NAME}: Sent notification to Slack.`);
    return;
  }

  // Option B: Forward to Telegram Bot API
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: textMessage
      })
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Telegram API failed (${res.status}): ${errBody}`);
    }
    console.log(`[${new Date().toISOString()}] [INFO] ${POD_NAME}: Sent notification to Telegram.`);
    return;
  }

  console.warn(
    `[${new Date().toISOString()}] [WARN] ${POD_NAME}: No external chat credentials set. Message that would be sent:\n${textMessage}`
  );
}

async function startBroadcaster() {
  let retries = 10;
  while (retries > 0) {
    try {
      const nc = await connect({ servers: NATS_URL });
      console.log(
        `[${new Date().toISOString()}] [INFO] ${POD_NAME}: Connected to NATS at ${nc.getServer()} (Queue Group: ${QUEUE_GROUP})`
      );

      // Subscribe with a queue group so only ONE replica processes each message
      const sub = nc.subscribe('todos.events', { queue: QUEUE_GROUP });

      for await (const msg of sub) {
        try {
          const decoded = sc.decode(msg.data);
          const eventData = JSON.parse(decoded);
          console.log(`[${new Date().toISOString()}] [INFO] ${POD_NAME}: Received NATS message: ${decoded}`);
          await forwardToChat(eventData);
        } catch (err) {
          console.error(`[${new Date().toISOString()}] [ERROR] ${POD_NAME}: Failed to process message:`, err.message);
        }
      }
      break;
    } catch (err) {
      if(!retries){
        console.error(
          `[${new Date().toISOString()}] [ERROR] ${POD_NAME}: NATS connection failed, after 10 retries, Exiting...`,
          err.message
        );
      }
      retries -= 1;
      console.error(
        `[${new Date().toISOString()}] [ERROR] ${POD_NAME}: NATS connection failed, retrying in 3s... (${retries} left):`,
        err.message
      );
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

startBroadcaster();
