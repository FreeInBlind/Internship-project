-- EcoPoints MySQL schema for the local course demo.
-- EcoPoints 本地课程演示数据库结构。
CREATE DATABASE IF NOT EXISTS ecopoints_11 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ecopoints_11;

CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT, full_name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL,
  role ENUM('user', 'organization', 'admin') NOT NULL DEFAULT 'user', organization_id INT NULL, subscription_tier VARCHAR(20) NOT NULL DEFAULT 'basic', subscription_started_at DATETIME NULL, subscription_expires_at DATETIME NULL, campus VARCHAR(120), department VARCHAR(120),
  avatar_url LONGTEXT NULL, phone VARCHAR(40) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY ix_users_organization_id (organization_id)
);
CREATE TABLE IF NOT EXISTS initiatives (
  id INT PRIMARY KEY AUTO_INCREMENT, title VARCHAR(160) NOT NULL, description TEXT NOT NULL,
  category VARCHAR(80) NOT NULL, points INT NOT NULL, start_date DATETIME NULL, end_date DATETIME NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS point_transactions (
  id INT PRIMARY KEY AUTO_INCREMENT, user_id INT NOT NULL, initiative_id INT NULL, points INT NOT NULL,
  note VARCHAR(255), created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (initiative_id) REFERENCES initiatives(id),
  KEY ix_point_user_created (user_id, created_at)
);
CREATE TABLE IF NOT EXISTS transport_rules (
  mode VARCHAR(20) PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT TRUE,
  min_distance_m INT NOT NULL, min_duration_s INT NOT NULL,
  max_speed_kmh DOUBLE NOT NULL, points INT NOT NULL,
  updated_by INT NULL, updated_at DATETIME NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS transport_trips (
  id INT PRIMARY KEY AUTO_INCREMENT, user_id INT NOT NULL, mode VARCHAR(20) NOT NULL,
  source VARCHAR(20) NOT NULL, source_filename VARCHAR(255) NULL, file_hash VARCHAR(64) NULL,
  track_hash VARCHAR(64) NOT NULL, started_at DATETIME NOT NULL, ended_at DATETIME NOT NULL,
  distance_m DOUBLE NOT NULL, duration_s DOUBLE NOT NULL, point_count INT NOT NULL,
  status VARCHAR(20) NOT NULL, validation_message VARCHAR(500) NOT NULL, warnings JSON NOT NULL,
  points_awarded INT NOT NULL DEFAULT 0, point_transaction_id INT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (point_transaction_id) REFERENCES point_transactions(id),
  UNIQUE KEY uq_transport_user_track_mode (user_id, track_hash, mode),
  KEY ix_transport_user_created (user_id, created_at)
);

CREATE TABLE IF NOT EXISTS rewards (
  id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(160) NOT NULL, description TEXT NOT NULL,
  points_cost INT NOT NULL, stock INT NOT NULL DEFAULT 0, icon VARCHAR(40) NOT NULL DEFAULT 'gift', is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS redemptions (
  id INT PRIMARY KEY AUTO_INCREMENT, user_id INT NOT NULL, reward_id INT NOT NULL, points_spent INT NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'requested', contact_phone VARCHAR(40) NOT NULL, contact_email VARCHAR(255) NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (reward_id) REFERENCES rewards(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INT PRIMARY KEY AUTO_INCREMENT, user_id INT NOT NULL, kind VARCHAR(60) NOT NULL,
  title VARCHAR(160) NOT NULL, message TEXT NOT NULL, entity_type VARCHAR(60) NULL,
  entity_id INT NULL, is_read BOOLEAN NOT NULL DEFAULT FALSE, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id), KEY idx_notifications_user_created (user_id, created_at)
);
CREATE TABLE IF NOT EXISTS subscription_requests (
  id INT PRIMARY KEY AUTO_INCREMENT, user_id INT NOT NULL, requested_tier VARCHAR(20) NOT NULL DEFAULT 'plus',
  payment_reference VARCHAR(160) NULL, status VARCHAR(40) NOT NULL DEFAULT 'pending', reviewed_by INT NULL,
  reviewed_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (reviewed_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS organization_applications (
  id INT PRIMARY KEY AUTO_INCREMENT, user_id INT NOT NULL, organization_name VARCHAR(180) NOT NULL,
  registration_number VARCHAR(120) NULL, status VARCHAR(40) NOT NULL DEFAULT 'pending',
  document_name VARCHAR(255) NOT NULL, document_content_type VARCHAR(120) NOT NULL, document_data LONGBLOB NOT NULL,
  reviewed_by INT NULL, reviewed_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (reviewed_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS activity_requests (
  id INT PRIMARY KEY AUTO_INCREMENT, user_id INT NOT NULL, title VARCHAR(160) NOT NULL, description TEXT NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'pending', reviewed_by INT NULL, reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (reviewed_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS organizations (
  id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(180) NOT NULL,
  slug VARCHAR(200) NOT NULL UNIQUE, created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS organization_datasets (
  id INT PRIMARY KEY AUTO_INCREMENT, organization_id INT NOT NULL, uploaded_by INT NOT NULL,
  name VARCHAR(180) NOT NULL, source_filename VARCHAR(255) NOT NULL,
  columns JSON NOT NULL, row_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (uploaded_by) REFERENCES users(id),
  KEY idx_dataset_organization_created (organization_id, created_at)
);
CREATE TABLE IF NOT EXISTS organization_data_rows (
  id INT PRIMARY KEY AUTO_INCREMENT, dataset_id INT NOT NULL, row_number INT NOT NULL,
  data JSON NOT NULL, FOREIGN KEY (dataset_id) REFERENCES organization_datasets(id) ON DELETE CASCADE,
  UNIQUE KEY uq_dataset_row (dataset_id, row_number)
);
CREATE TABLE IF NOT EXISTS dashboard_layouts (
  user_id INT PRIMARY KEY, widgets JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
