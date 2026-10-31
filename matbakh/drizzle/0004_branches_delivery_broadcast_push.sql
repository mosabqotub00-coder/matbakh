CREATE TABLE `branches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`city` varchar(120) NOT NULL,
	`ordersEnabled` boolean NOT NULL DEFAULT true,
	`isLegacy` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `branches_id` PRIMARY KEY(`id`),
	CONSTRAINT `branches_name_city_uq` UNIQUE(`name`,`city`)
);
--> statement-breakpoint
CREATE TABLE `data_migration_journal` (
	`marker` varchar(120) NOT NULL,
	`applied_at` timestamp NOT NULL DEFAULT (now()),
	`details` text,
	CONSTRAINT `data_migration_journal_marker` PRIMARY KEY(`marker`)
);
--> statement-breakpoint
CREATE TABLE `notification_reads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`notification_id` int NOT NULL,
	`user_id` int NOT NULL,
	`read_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notification_reads_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_read_user_uq` UNIQUE(`notification_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`order_id` int,
	`type` varchar(48) NOT NULL,
	`title` varchar(180) NOT NULL,
	`body` text NOT NULL,
	`target_section` enum('station','kitchen','all') NOT NULL DEFAULT 'all',
	`target_role` varchar(32),
	`dedupe_key` varchar(220),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_dedupe_uq` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`endpoint` varchar(2048) NOT NULL,
	`endpoint_hash` varchar(64) NOT NULL,
	`p256dh` varchar(255) NOT NULL,
	`auth` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `push_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `push_subscription_endpoint_hash_uq` UNIQUE(`endpoint_hash`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`setting_key` varchar(120) NOT NULL,
	`setting_value` text NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `settings_setting_key` PRIMARY KEY(`setting_key`)
);
--> statement-breakpoint
CREATE TABLE `broadcast_chunks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`broadcast_id` int NOT NULL,
	`sequence` int NOT NULL,
	`data` longblob NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `broadcast_chunks_id` PRIMARY KEY(`id`),
	CONSTRAINT `broadcast_chunk_sequence_uq` UNIQUE(`broadcast_id`,`sequence`)
);
--> statement-breakpoint
CREATE TABLE `broadcast_listens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`broadcast_id` int NOT NULL,
	`user_id` int NOT NULL,
	`listened_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `broadcast_listens_id` PRIMARY KEY(`id`),
	CONSTRAINT `broadcast_listen_user_uq` UNIQUE(`broadcast_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `broadcasts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`sender_id` int NOT NULL,
	`sender_name` varchar(120) NOT NULL,
	`target_section` enum('station','kitchen') NOT NULL,
	`order_id` int,
	`title` varchar(160) NOT NULL,
	`status` enum('live','ended','interrupted') NOT NULL DEFAULT 'live',
	`sample_rate` int NOT NULL DEFAULT 16000,
	`total_bytes` int NOT NULL DEFAULT 0,
	`total_chunks` int NOT NULL DEFAULT 0,
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`last_chunk_at` timestamp NOT NULL DEFAULT (now()),
	`ended_at` timestamp,
	CONSTRAINT `broadcasts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `integration_api_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`label` varchar(120) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`token_prefix` varchar(32) NOT NULL,
	`created_by_id` int,
	`created_by_name` varchar(120),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`revoked_at` timestamp,
	`revoked_by_id` int,
	`revoked_by_name` varchar(120),
	CONSTRAINT `integration_api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `integration_api_keys_token_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `integration_attempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`outbox_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`status` enum('sent','failed','skipped') NOT NULL,
	`response_status` int,
	`error` varchar(1000),
	`attempted_at` timestamp NOT NULL DEFAULT (now()),
	`duration_ms` int,
	CONSTRAINT `integration_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `integration_key_audit` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`key_id` int,
	`action` enum('created','revoked') NOT NULL,
	`actor_id` int,
	`actor_name` varchar(120),
	`detail` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `integration_key_audit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `integration_outbox` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`order_id` int,
	`event_type` varchar(80) NOT NULL,
	`payload` text NOT NULL,
	`status` enum('pending','delivered','failed','skipped') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`next_attempt_at` timestamp,
	`last_error` varchar(1000),
	`delivered_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integration_outbox_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `integration_webhook_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`webhook_url` varchar(2048),
	`enabled` boolean NOT NULL DEFAULT false,
	`provider_configured` boolean NOT NULL DEFAULT false,
	`updated_by_id` int,
	`updated_by_name` varchar(120),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integration_webhook_configs_id` PRIMARY KEY(`id`),
	CONSTRAINT `integration_webhook_configs_branch_uq` UNIQUE(`branch_id`)
);
--> statement-breakpoint
ALTER TABLE `kitchenOrderEvents` MODIFY COLUMN `status` enum('new','preparing','ready','received') NOT NULL;--> statement-breakpoint
ALTER TABLE `kitchenOrders` MODIFY COLUMN `status` enum('new','preparing','ready','received') NOT NULL DEFAULT 'new';--> statement-breakpoint
ALTER TABLE `kitchenOrderEvents` ADD `kind` enum('created','accepted','ready','received','extended') DEFAULT 'created' NOT NULL;--> statement-breakpoint
ALTER TABLE `kitchenOrderEvents` ADD `actorId` int;--> statement-breakpoint
ALTER TABLE `kitchenOrderEvents` ADD `previousDueAt` timestamp;--> statement-breakpoint
ALTER TABLE `kitchenOrderEvents` ADD `newDueAt` timestamp;--> statement-breakpoint
ALTER TABLE `kitchenOrderEvents` ADD `addedMinutes` int;--> statement-breakpoint
ALTER TABLE `kitchenOrderEvents` ADD `reason` varchar(500);--> statement-breakpoint
ALTER TABLE `kitchenOrderItems` ADD `graceMinutes` int DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `kitchenOrders` ADD `branchId` int;--> statement-breakpoint
ALTER TABLE `kitchenOrders` ADD `orderSource` enum('internal','kitchen_manager','external') DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE `kitchenOrders` ADD `createdById` int;--> statement-breakpoint
ALTER TABLE `kitchenOrders` ADD `createdByName` varchar(120);--> statement-breakpoint
ALTER TABLE `kitchenOrders` ADD `acceptedById` int;--> statement-breakpoint
ALTER TABLE `kitchenOrders` ADD `receivedAt` timestamp;--> statement-breakpoint
ALTER TABLE `kitchenOrders` ADD `receivedById` int;--> statement-breakpoint
ALTER TABLE `kitchenOrders` ADD `receivedByName` varchar(120);--> statement-breakpoint
ALTER TABLE `kitchenOrders` ADD `extensionMinutes` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `kitchenOrders` ADD `originalDueAt` timestamp;--> statement-breakpoint
ALTER TABLE `kitchenOrders` ADD `effectiveDueAt` timestamp;--> statement-breakpoint
ALTER TABLE `kitchenOrders` ADD `everOverdue` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `kitchenOrders` ADD `externalOrderId` varchar(160);--> statement-breakpoint
ALTER TABLE `kitchenOrders` ADD `externalItemId` varchar(160);--> statement-breakpoint
ALTER TABLE `kitchenOrders` ADD `syncStatus` enum('pending','synced','error','not_required') DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `branchId` int;--> statement-breakpoint
ALTER TABLE `products` ADD `graceMinutes` int DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `staff_users` ADD `role` enum('system_admin','branch_manager','kitchen_manager','shift_manager','station','kitchen') DEFAULT 'station' NOT NULL;--> statement-breakpoint
ALTER TABLE `staff_users` ADD `branch_id` int;--> statement-breakpoint
ALTER TABLE `staff_users` ADD `can_manage_users` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `staff_users` ADD `can_broadcast` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `staff_users` ADD `can_extend` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `kitchenOrders` ADD CONSTRAINT `orders_external_item_uq` UNIQUE(`branchId`,`externalOrderId`,`externalItemId`);--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_branch_name_uq` UNIQUE(`branchId`,`name`);--> statement-breakpoint
CREATE INDEX `notification_read_user_idx` ON `notification_reads` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notification_branch_created_idx` ON `notifications` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notification_order_created_idx` ON `notifications` (`order_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `push_subscription_user_updated_idx` ON `push_subscriptions` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `broadcast_branch_state_idx` ON `broadcasts` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `broadcast_order_idx` ON `broadcasts` (`order_id`);--> statement-breakpoint
CREATE INDEX `integration_api_keys_branch_created_idx` ON `integration_api_keys` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `integration_attempts_outbox_attempted_idx` ON `integration_attempts` (`outbox_id`,`attempted_at`);--> statement-breakpoint
CREATE INDEX `integration_attempts_branch_attempted_idx` ON `integration_attempts` (`branch_id`,`attempted_at`);--> statement-breakpoint
CREATE INDEX `integration_key_audit_branch_created_idx` ON `integration_key_audit` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `integration_outbox_pending_scan_idx` ON `integration_outbox` (`status`,`next_attempt_at`,`id`);--> statement-breakpoint
CREATE INDEX `integration_outbox_branch_created_idx` ON `integration_outbox` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `integration_outbox_order_event_idx` ON `integration_outbox` (`order_id`,`event_type`);--> statement-breakpoint
CREATE INDEX `orders_branch_status_idx` ON `kitchenOrders` (`branchId`,`status`);--> statement-breakpoint
CREATE INDEX `orders_branch_created_idx` ON `kitchenOrders` (`branchId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `products_branch_active_idx` ON `products` (`branchId`,`isActive`);--> statement-breakpoint
CREATE INDEX `staff_users_branch_role_idx` ON `staff_users` (`branch_id`,`role`);