-- schema.sql
-- Drop existing tables if recreating (use with caution in development)
DROP TABLE IF EXISTS blocks;

DROP TABLE IF EXISTS message_read_status;

DROP TABLE IF EXISTS conversation_participants;

DROP TABLE IF EXISTS messages;

DROP TABLE IF EXISTS conversations;

DROP TABLE IF EXISTS app_config;

DROP TABLE IF EXISTS users;

-- Stores application-level configuration
CREATE TABLE app_config
(
    config_key TEXT PRIMARY KEY NOT NULL,
    config_value TEXT NOT NULL
);

-- Stores user accounts (admin and regular users)
CREATE TABLE
    users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE, -- Case-insensitive unique check
        password_hash TEXT NOT NULL,
        is_admin BOOLEAN NOT NULL DEFAULT 0 CHECK
(is_admin IN
(0, 1)),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_active_ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

-- Stores 1-on-1 conversations
CREATE TABLE
    conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        creator_id INTEGER, -- Can be NULL if creator user is deleted
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_activity_ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY
(creator_id) REFERENCES users
(id) ON
DELETE
SET NULL
);

-- Links users to conversations (always 2 for 1-on-1 in this version)
CREATE TABLE conversation_participants
(
    conversation_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (conversation_id, user_id),
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Stores individual messages
CREATE TABLE
    messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        content TEXT NOT NULL CHECK
(
            length
(content) > 0
            AND length
(content) <= 1000
        ),
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        is_edited BOOLEAN NOT NULL DEFAULT 0 CHECK
(is_edited IN
(0, 1)),
        edited_at DATETIME NULL,
        reply_to_message_id INTEGER NULL,
        FOREIGN KEY
(conversation_id) REFERENCES conversations
(id) ON
DELETE CASCADE,
        FOREIGN KEY (sender_id)
REFERENCES users
(id) ON
DELETE CASCADE,
        FOREIGN KEY (reply_to_message_id)
REFERENCES messages
(id) ON
DELETE
SET NULL
);

-- Stores read status for each user per message
CREATE TABLE message_read_status
(
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    -- The user who read the message
    read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, user_id),
    FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Stores user blocking information (blocker -> blocked)
CREATE TABLE blocks
(
    blocker_id INTEGER NOT NULL,
    -- User initiating the block
    blocked_id INTEGER NOT NULL,
    -- User being blocked
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (blocker_id, blocked_id),
    FOREIGN KEY (blocker_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (blocked_id) REFERENCES users (id) ON DELETE CASCADE,
    CHECK (blocker_id != blocked_id)
);

-- Indexes for performance
CREATE INDEX
IF NOT EXISTS idx_users_username ON users
(username COLLATE NOCASE);

CREATE INDEX
IF NOT EXISTS idx_conversations_last_activity ON conversations
(last_activity_ts DESC);

CREATE INDEX
IF NOT EXISTS idx_conversation_participants_user ON conversation_participants
(user_id);

CREATE INDEX
IF NOT EXISTS idx_conversation_participants_conv ON conversation_participants
(conversation_id);

CREATE INDEX
IF NOT EXISTS idx_messages_conversation_ts ON messages
(conversation_id, timestamp DESC);

CREATE INDEX
IF NOT EXISTS idx_message_read_status_user ON message_read_status
(user_id);

CREATE INDEX
IF NOT EXISTS idx_message_read_status_message ON message_read_status
(message_id);

CREATE INDEX
IF NOT EXISTS idx_blocks_blocked ON blocks
(blocked_id);

CREATE INDEX
IF NOT EXISTS idx_blocks_blocker ON blocks
(blocker_id);

CREATE INDEX
IF NOT EXISTS idx_users_last_active ON users
(last_active_ts DESC);

CREATE INDEX
IF NOT EXISTS idx_messages_reply_to ON messages
(reply_to_message_id);

CREATE INDEX
IF NOT EXISTS idx_messages_sender ON messages
(sender_id);

-- Initial configuration state
INSERT
OR
IGNORE INTO app_config (config_key, config_value)
VALUES
    ('admin_created', 'false');

INSERT
OR
IGNORE INTO app_config (config_key, config_value)
VALUES
    ('master_password_hash', '');

-- Ensure it exists