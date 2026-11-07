CREATE TABLE IF NOT EXISTS todo_lists (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(32) NOT NULL DEFAULT '#6366f1',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE todos ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE todos ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE todos ADD COLUMN IF NOT EXISTS list_id BIGINT;

ALTER TABLE todos ADD CONSTRAINT fk_todos_list
    FOREIGN KEY (list_id) REFERENCES todo_lists(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_todos_list_id ON todos(list_id);
CREATE INDEX IF NOT EXISTS idx_todos_priority ON todos(priority);
CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);

INSERT INTO todo_lists (name, color) VALUES ('Work & Architecture', '#6366f1');
INSERT INTO todo_lists (name, color) VALUES ('Personal', '#06b6d4');
INSERT INTO todo_lists (name, color) VALUES ('Launch Checklist', '#10b981');

INSERT INTO todos (title, description, completed, priority, due_date, list_id)
VALUES (
    'Verify Nginx least_conn load balancing across 3 replicas',
    'Open /monitor and send 20 test requests to observe X-Served-By distribution',
    FALSE,
    'HIGH',
    CURRENT_DATE,
    1
);

INSERT INTO todos (title, description, completed, priority, due_date, list_id)
VALUES (
    'Demo Bucket4j per-IP write rate limiting (HTTP 429)',
    'Trigger 20 writes/min limit and inspect Retry-After response header',
    FALSE,
    'MEDIUM',
    CURRENT_DATE + 2,
    3
);

