CREATE TABLE IF NOT EXISTS `native_push_devices` (
  `id` int AUTO_INCREMENT NOT NULL,
  `installation_id` varchar(64) NOT NULL,
  `user_id` int NOT NULL,
  `session_hash` varchar(64) NOT NULL,
  `expo_push_token` varchar(255) NOT NULL,
  `platform` varchar(16) NOT NULL DEFAULT 'android',
  `app_version` varchar(32),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `native_push_devices_id` PRIMARY KEY(`id`),
  CONSTRAINT `native_push_installation_uq` UNIQUE(`installation_id`)
);
--> statement-breakpoint
CREATE INDEX `native_push_user_idx` ON `native_push_devices` (`user_id`);
--> statement-breakpoint
CREATE INDEX `native_push_token_idx` ON `native_push_devices` (`expo_push_token`);
