const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// URL the browser uses to reach todo-backend (defaults to '/todos' for Ingress routing)
const TODOS_API_URL = process.env.TODOS_API_URL || '/todos';

// Directory mounted to the Kubernetes PersistentVolumeClaim
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'files');
const IMAGE_PATH = path.join(CACHE_DIR, 'image.jpg');
const TEN_MINUTES_MS = 10 * 60 * 1000;
const Picsum = process.env.IMAGE_URL || 'https://picsum.photos/1200';

let isFetching = false;

// Ensure the cache directory exists on startup
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

async function downloadNewImage() {
  if (isFetching) return;
  isFetching = true;
  try {
    console.log('Fetching a new image from Lorem Picsum...');
    const response = await fetch(Picsum);
    if (!response.ok) {
      throw new Error(`Unexpected response: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const tempPath = `${IMAGE_PATH}.tmp`;
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, IMAGE_PATH);
    console.log('New image cached successfully.');
  } catch (error) {
    console.error('Error downloading image:', error);
  } finally {
    isFetching = false;
  }
}


// Respond to GET requests on the root URL
app.get('/health', (req, res) => {
  res.send("Hello! Ako's project server is running.");
});

// Health check
app.get('/healthz', async (req, res) => {
  console.log(`Trying to probe tods at ${TODOS_API_URL}/health`)

  try {
    // Abort after 1.5s so we respond BEFORE Kubernetes' 3s timeoutSeconds
    const response = await fetch(`${TODOS_API_URL}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    //console.log(`Tried to fetch ${TODOS_API_URL}/health`);
    if (response.ok) {
      return res.status(200).send('OK');
    }

    return res.status(500).send('todos bakcend returned error');
  } catch (err) {
    return res.status(500).send('Cannot reach todos bnackend service');
  }

});

// Serve the image file and manage the 10-minute expiration logic
app.get('/image', async (req, res) => {
  if (!fs.existsSync(IMAGE_PATH)) {
    await downloadNewImage();
    return res.sendFile(IMAGE_PATH);
  }

  const stats = fs.statSync(IMAGE_PATH);
  const ageMs = Date.now() - stats.mtimeMs;

  if (ageMs > TEN_MINUTES_MS) {
    console.log('Image is older than 10 minutes. Serving old image once more and refreshing for next request...');
    res.sendFile(IMAGE_PATH, () => {
      downloadNewImage();
    });
  } else {
    res.sendFile(IMAGE_PATH);
  }
});

// Root URL serving the HTML and client-side JavaScript
app.get('/', (req, res) => {
  let ageSeconds = 'Downloading image...';
  let ageDisplay = ageSeconds;
  if (fs.existsSync(IMAGE_PATH)) {
    const stats = fs.statSync(IMAGE_PATH);
    ageSeconds = Math.floor((Date.now() - stats.mtimeMs) / 1000);
    ageDisplay = `${Math.floor(ageSeconds / 60)}m ${String(ageSeconds % 60).padStart(2, '0')}s old`;
    //ageSeconds = `${Math.floor((Date.now() - stats.mtimeMs) / 1000)}s old`;
  }

  
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Ako's Todo App</title>
        <style>
          :root {
            --bg: #f1f5f9;
            --surface: #ffffff;
            --text-main: #0f172a;
            --text-muted: #64748b;
            --primary: #4f46e5;
            --primary-hover: #4338ca;
            --success: #10b981;
            --success-bg: #ecfdf5;
            --danger: #ef4444;
            --border: #e2e8f0;
          }
          * { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, sans-serif;
            background: var(--bg);
            color: var(--text-main);
            margin: 0;
            padding: 2rem 1rem;
          }
          .container {
            max-width: 760px;
            margin: 0 auto;
          }
          .card {
            background: var(--surface);
            border-radius: 16px;
            box-shadow: 0 4px 20px rgba(15, 23, 42, 0.06);
            overflow: hidden;
            margin-bottom: 1.5rem;
            border: 1px solid var(--border);
          }
          .hero {
            position: relative;
            height: 220px;
            background: #1e293b;
          }
          .hero img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
          }
          .hero-overlay {
            position: absolute;
            inset: 0;
            background: linear-gradient(to top, rgba(15, 23, 42, 0.85), rgba(15, 23, 42, 0.15));
            display: flex;
            flex-direction: column;
            justify-content: flex-end;
            padding: 1.5rem;
            color: white;
          }
          .hero-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            gap: 1rem;
            flex-wrap: wrap;
          }
          .hero-header h1 {
            margin: 0;
            font-size: 1.65rem;
            font-weight: 700;
            letter-spacing: -0.02em;
          }
          .cache-badge {
            background: rgba(255, 255, 255, 0.18);
            backdrop-filter: blur(8px);
            padding: 0.35rem 0.75rem;
            border-radius: 999px;
            font-size: 0.8rem;
            font-weight: 500;
          }
          .content {
            padding: 1.5rem;
          }
          .todo-form {
            display: flex;
            gap: 0.75rem;
            margin-bottom: 0.4rem;
          }
          .input-wrapper {
            position: relative;
            flex: 1;
          }
          .todo-input {
            width: 100%;
            padding: 0.8rem 4rem 0.8rem 1rem;
            font-size: 0.95rem;
            border: 1.5px solid var(--border);
            border-radius: 10px;
            outline: none;
            transition: border-color 0.15s, box-shadow 0.15s;
          }
          .todo-input:focus {
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12);
          }
          .char-counter {
            position: absolute;
            right: 0.75rem;
            top: 50%;
            transform: translateY(-50%);
            font-size: 0.75rem;
            color: var(--text-muted);
          }
          .send-btn {
            background: var(--primary);
            color: white;
            font-weight: 600;
            font-size: 0.95rem;
            border: none;
            padding: 0 1.35rem;
            border-radius: 10px;
            cursor: pointer;
            transition: background 0.15s, transform 0.05s;
            white-space: nowrap;
          }
          .send-btn:hover { background: var(--primary-hover); }
          .send-btn:active { transform: scale(0.98); }
          .error-banner {
            display: none;
            background: #fef2f2;
            color: #b91c1c;
            border: 1px solid #fecaca;
            padding: 0.65rem 0.9rem;
            border-radius: 8px;
            font-size: 0.85rem;
            margin-top: 0.75rem;
          }
          .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin: 1.5rem 0 0.75rem;
          }
          .section-title {
            font-size: 0.85rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: var(--text-muted);
            margin: 0;
          }
          .count-pill {
            background: #e2e8f0;
            color: #334155;
            font-size: 0.75rem;
            font-weight: 700;
            padding: 0.15rem 0.6rem;
            border-radius: 999px;
          }
          .todo-list {
            list-style: none;
            padding: 0;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: 0.6rem;
          }
          .todo-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
            padding: 0.85rem 1rem;
            background: #f8fafc;
            border: 1px solid var(--border);
            border-radius: 10px;
            transition: all 0.15s ease;
          }
          .todo-item:hover {
            border-color: #cbd5e1;
            background: #ffffff;
          }
          .todo-item.completed {
            background: #f8fafc;
            opacity: 0.75;
          }
          .todo-text {
            font-size: 0.95rem;
            line-height: 1.45;
            word-break: break-word;
            flex: 1;
          }
          .todo-item.completed .todo-text {
            text-decoration: line-through;
            color: var(--text-muted);
          }
          .action-btn {
            border: 1px solid #cbd5e1;
            background: white;
            color: var(--text-main);
            font-size: 0.8rem;
            font-weight: 600;
            padding: 0.45rem 0.85rem;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.15s;
            white-space: nowrap;
          }
          .action-btn.done-btn:hover {
            background: var(--success);
            border-color: var(--success);
            color: white;
          }
          .action-btn.undo-btn {
            color: var(--text-muted);
          }
          .action-btn.undo-btn:hover {
            background: #e2e8f0;
            color: var(--text-main);
          }
          .empty-state {
            text-align: center;
            padding: 1.25rem;
            color: var(--text-muted);
            font-size: 0.9rem;
            background: #f8fafc;
            border-radius: 10px;
            border: 1px dashed var(--border);
          }
          .footer-controls {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 1.5rem;
            background: #f8fafc;
            border-top: 1px solid var(--border);
            font-size: 0.85rem;
            color: var(--text-muted);
          }
          .crash-btn {
            background: transparent;
            color: var(--danger);
            border: 1px solid #fca5a5;
            padding: 0.45rem 0.9rem;
            border-radius: 8px;
            font-weight: 600;
            font-size: 0.8rem;
            cursor: pointer;
            transition: all 0.15s;
          }
          .crash-btn:hover {
            background: var(--danger);
            color: white;
            border-color: var(--danger);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="hero">
              <img src="/image" alt="Random Picsum Banner" />
              <div class="hero-overlay">
                <div class="hero-header">
                  <h1>Ako's Todo app</h1>
                  <span class="cache-badge">Cached Image: ${ageDisplay}</span>
                </div>
              </div>
            </div>

            <div class="content">
              <form id="todo-form" class="todo-form">
                <div class="input-wrapper">
                  <input
                    type="text"
                    id="todo-input"
                    class="todo-input"
                    name="todo"
                    maxlength="140"
                    placeholder="What needs to be done?"
                    required
                  />
                  <span id="char-count" class="char-counter">0/140</span>
                </div>
                <button type="submit" class="send-btn">Add Task</button>
              </form>
              <div id="error-banner" class="error-banner"></div>

              <div class="section-header">
                <h2 class="section-title">Active Tasks</h2>
                <span id="active-count" class="count-pill">0</span>
              </div>
              <ul id="active-todo-list" class="todo-list"></ul>

              <div class="section-header">
                <h2 class="section-title">Completed</h2>
                <span id="done-count" class="count-pill">0</span>
              </div>
              <ul id="done-todo-list" class="todo-list"></ul>
            </div>

            <div class="footer-controls">
              <span>Testing resilience & PVC persistence</span>
              <form action="/crash" method="POST" style="margin: 0;">
                <button type="submit" class="crash-btn">Simulate Container Crash</button>
              </form>
            </div>
          </div>
        </div>

        <script>
          const API_URL = '/todos';
          const activeListEl = document.getElementById('active-todo-list');
          const doneListEl = document.getElementById('done-todo-list');
          const activeCountEl = document.getElementById('active-count');
          const doneCountEl = document.getElementById('done-count');
          const todoFormEl = document.getElementById('todo-form');
          const todoInputEl = document.getElementById('todo-input');
          const charCountEl = document.getElementById('char-count');
          const errorBannerEl = document.getElementById('error-banner');

          todoInputEl.addEventListener('input', () => {
            charCountEl.textContent = todoInputEl.value.length + '/140';
          });

          function showError(msg) {
            errorBannerEl.textContent = msg;
            errorBannerEl.style.display = msg ? 'block' : 'none';
          }

          function createTodoElement(todo) {
            const item = typeof todo === 'string'
              ? { id: null, content: todo, done: false }
              : todo;

            const li = document.createElement('li');
            li.className = 'todo-item' + (item.done ? ' completed' : '');

            const span = document.createElement('span');
            span.className = 'todo-text';
            span.textContent = item.content;
            li.appendChild(span);

            if (item.id !== null) {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'action-btn ' + (item.done ? 'undo-btn' : 'done-btn');
              btn.textContent = item.done ? 'Undo' : 'Mark Done';
              btn.addEventListener('click', () => toggleTodoDone(item.id, !item.done));
              li.appendChild(btn);
            }

            return li;
          }

          function renderTodos(todos) {
            activeListEl.innerHTML = '';
            doneListEl.innerHTML = '';

            const activeTodos = todos.filter(t => !t.done);
            const doneTodos = todos.filter(t => t.done);

            activeCountEl.textContent = activeTodos.length;
            doneCountEl.textContent = doneTodos.length;

            if (activeTodos.length === 0) {
              const empty = document.createElement('div');
              empty.className = 'empty-state';
              empty.textContent = 'All caught up! Add a new todo above.';
              activeListEl.appendChild(empty);
            } else {
              activeTodos.forEach(todo => activeListEl.appendChild(createTodoElement(todo)));
            }

            if (doneTodos.length === 0) {
              const empty = document.createElement('div');
              empty.className = 'empty-state';
              empty.textContent = 'No completed tasks yet.';
              doneListEl.appendChild(empty);
            } else {
              doneTodos.forEach(todo => doneListEl.appendChild(createTodoElement(todo)));
            }
          }

          async function fetchTodos() {
            try {
              const res = await fetch(API_URL);
              const todos = await res.json();
              renderTodos(todos);
            } catch (err) {
              console.error('Failed to fetch todos:', err);
              showError('Could not load todos from backend.');
            }
          }

          async function toggleTodoDone(id, doneStatus) {
            showError('');
            try {
              const res = await fetch(API_URL + '/' + id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ done: doneStatus })
              });
              const data = await res.json();
              if (!res.ok) {
                showError(data.error || 'Failed to update todo.');
                return;
              }
              renderTodos(data.todos);
            } catch (err) {
              console.error('Failed to update todo:', err);
              showError('Network error while updating todo.');
            }
          }

          todoFormEl.addEventListener('submit', async (e) => {
            e.preventDefault();
            showError('');
            const todoText = todoInputEl.value.trim();
            if (!todoText) return;

            try {
              const res = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ todo: todoText })
              });
              const data = await res.json();
              if (!res.ok) {
                showError(data.error || 'Failed to create todo.');
                return;
              }
              renderTodos(data.todos);
              todoInputEl.value = '';
              charCountEl.textContent = '0/140';
            } catch (err) {
              console.error('Failed to create todo:', err);
              showError('Network error while creating todo.');
            }
          });

          fetchTodos();
        </script>
      </body>
    </html>
  `);
  
});


// Testing endpoint to intentionally shut down the container
app.post('/crash', (req, res) => {
  console.log('Simulating container crash via /crash endpoint...');
  res.send('Crashing container now. Refresh the root page in a few seconds to verify volume persistence.');
  setTimeout(() => {
    process.exit(1);
  }, 200);
});

app.listen(PORT, () => {
  console.log('Server started in port ', PORT);
});