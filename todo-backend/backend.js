const express = require('express');
const { Pool } = require('pg');
const { connect, StringCodec } = require('nats');


const app = express();
const PORT = process.env.PORT || 8090;
const NATS_URL = process.env.NATS_URL || 'nats://nats:4222';

const sc = StringCodec();
let natsConn = null;

// Connect to NATS in the background
async function initNats() {
  while (!natsConn) {
    try {
      natsConn = await connect({
        servers: NATS_URL,
        reconnect: true,
        maxReconnectAttempts: -1, // Keep reconnecting indefinitely if NATS restarts
      });
      console.log(`[${new Date().toISOString()}] [INFO] Connected to NATS at ${natsConn.getServer()}`);
    } catch (err) {
      console.error(
        `[${new Date().toISOString()}] [ERROR] Could not connect to NATS at ${NATS_URL}, retrying in 3s... (${err.message})`
      );
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

initNats();

function publishTodoEvent(action, todo) {
  if (!natsConn) {
    console.warn(`[${new Date().toISOString()}] [WARN] NATS not connected; skipping event publish.`);
    return;
  }
  const payload = JSON.stringify({
    user: 'bot',
    action,
    todo
  });
  natsConn.publish('todos.events', sc.encode(payload));
  console.log(`[${new Date().toISOString()}] [NATS] Published ${action} event for todo #${todo.id}`);
}

// Configure the PostgreSQL connection pool using environment variables
const pool = new Pool({
  host: process.env.DB_HOST || 'ako-postgres-svc',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.POSTGRES_DB || 'appdb',
  user: process.env.POSTGRES_USER || 'appuser',
  password: process.env.POSTGRES_PASSWORD || 'supersecretpassword',
});


// Parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  // Log incoming payload for POST requests
  if (req.method === 'POST') {
    console.log(`[${timestamp}] [INFO] Incoming ${req.method} ${req.originalUrl} - Payload: ${JSON.stringify(req.body)}`);
  }

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] [REQUEST] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`
    );
  });

  next();
});



// Allow cross-origin requests during local development across different ports
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});


// Initialize the database table and seed initial todos if empty
async function initDb() {
  let retries = 10;
  while (retries > 0) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS todos (
          id SERIAL PRIMARY KEY,
          content VARCHAR(140) NOT NULL,
          done BOOLEAN NOT NULL DEFAULT FALSE
        );
      `);

      await pool.query(`
        ALTER TABLE todos ADD COLUMN IF NOT EXISTS done BOOLEAN NOT NULL DEFAULT FALSE;
      `);


      const { rowCount } = await pool.query('SELECT 1 FROM todos LIMIT 1');
      if (rowCount === 0) {
        await pool.query(`
          INSERT INTO todos (content, done) VALUES
            ('Learn Kubernetes fundamentals', true),
            ('Configure PersistentVolume and Ingress in k3d', true),
            ('Build the Todo backend microservice', true);
        `);

        console.log(`[${new Date().toISOString()}] [INFO] Seeded initial todos into PostgreSQL.`);
      }

      console.log(`[${new Date().toISOString()}] [INFO] Connected and initialized PostgreSQL database.`);
      break;
    } catch (err) {
      if(!retries){
        console.error(
          `[${new Date().toISOString()}] [ERROR] Database not ready after 10 retries, Exiting...`,
          err.message
        );
        break;
      }
      retries -= 1;
      console.warn(
        `[${new Date().toISOString()}] [WARN] Database not ready yet, retrying in 3s... (${retries} retries left):`,
        err.message
      );
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

// Helper to fetch all todos ordered by id
async function getAllTodos() {
  const result = await pool.query('SELECT id, content, done FROM todos ORDER BY id ASC');
  return result.rows;
}

// Helath checks 
app.get('/health', (req, res) => {
  res.send("Hello! todos backend is running.");
});

app.get('/healthz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).send('OK');
  } catch (err) {
    console.error(err.message`[${new Date().toISOString()}] [ERROR] Database readiness check failed:`, err.message);
    res.status(500).json( {error: 'Database not connected'});
  }
});


// Fetch all todos
app.get('/todos', async (req, res) => {
  try {
    const todos = await getAllTodos();
    //const todos = result.rows.map(row => row.content);
    res.json(todos);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [ERROR] Failed to fetch todos:`, err.message);
    res.status(500).json({ error: 'Database error while fetching todos.' });
  }
});

// Create a new todo
app.post('/todos',async (req, res) => {
  const rawTodo = typeof req.body.todo === 'string' ? req.body.todo.trim() : '';

  if (!rawTodo) {
    console.warn(`[${new Date().toISOString()}] [WARN] Blocked empty todo submission.`);
    return res.status(400).json({ error: 'Todo content cannot be empty.' });
  }

  if (rawTodo.length > 140) {
    console.warn(
      `[${new Date().toISOString()}] [BLOCKED] Todo rejected: length ${rawTodo.length} exceeds 140-character limit. Content: "${rawTodo}"`
    );
    return res.status(400).json({ 
      error: `Todo cannot exceed 140 characters (received ${rawTodo.length} characters).`
    });
  }

  try {
    const insertResult = await pool.query(
      'INSERT INTO todos (content, done) VALUES ($1, FALSE) RETURNING id, content, done',
      [rawTodo]
    );

    const createdTodo = insertResult.rows[0];
    console.log(
      `[${new Date().toISOString()}] [CREATED] Saved todo #${createdTodo.id} (${rawTodo.length} chars): "${rawTodo}"`
    );

    // 1. Publish creation event to NATS
    publishTodoEvent('created', createdTodo);

    const todos = await getAllTodos();

    res.status(201).json({ todo: rawTodo, todos });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [ERROR] Failed to insert todo:`, err.message);
    res.status(500).json({ error: 'Database error while creating todo.' });
  }
});


// PUT /todos/:id - Mark a todo as done (or toggle its done status)
app.put('/todos/:id', async (req, res) => {
  const todoId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(todoId)) {
    return res.status(400).json({ error: 'Invalid todo ID.' });
  }

  // Default to true if 'done' is not explicitly passed in body
  const doneValue = typeof req.body?.done === 'boolean' ? req.body.done : true;

  try {
    const updateResult = await pool.query(
      'UPDATE todos SET done = $1 WHERE id = $2 RETURNING id, content, done',
      [doneValue, todoId]
    );

    if (updateResult.rowCount === 0) {
      console.warn(`[${new Date().toISOString()}] [WARN] Todo #${todoId} not found for PUT update.`);
      return res.status(404).json({ error: `Todo with id ${todoId} not found.` });
    }

    const updatedTodo = updateResult.rows[0];
    console.log(
      `[${new Date().toISOString()}] [UPDATED] Todo #${updatedTodo.id} marked as done=${updatedTodo.done}: "${updatedTodo.content}"`
    );

    // 2. Publish update event to NATS
    publishTodoEvent('updated', updatedTodo);

    const todos = await getAllTodos();
    res.json({ todo: updatedTodo, todos });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [ERROR] Failed to update todo #${todoId}:`, err.message);
    res.status(500).json({ error: 'Database error while updating todo.' });
  }
});


initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[${new Date().toISOString()}] [INFO] todo-backend started on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error( `[${new Date().toISOString()}] [ERROR] Failed to initialize launch todos backend. Exiting...`, err.message);
    process.exit(1);
  });
