CREATE TABLE `kitchenOrderEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`status` enum('new','preparing','ready') NOT NULL,
	`actor` varchar(120) NOT NULL DEFAULT 'موظف الوردية',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`detail` varchar(255),
	CONSTRAINT `kitchenOrderEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kitchenOrderItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`productId` int NOT NULL,
	`productName` varchar(120) NOT NULL,
	`quantity` int NOT NULL,
	`prepMinutes` int NOT NULL,
	CONSTRAINT `kitchenOrderItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kitchenOrders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderCode` varchar(24) NOT NULL,
	`status` enum('new','preparing','ready') NOT NULL DEFAULT 'new',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`acceptedAt` timestamp,
	`readyAt` timestamp,
	CONSTRAINT `kitchenOrders_id` PRIMARY KEY(`id`),
	CONSTRAINT `kitchenOrders_orderCode_unique` UNIQUE(`orderCode`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`category` varchar(80) NOT NULL DEFAULT 'دجاج',
	`prepMinutes` int NOT NULL DEFAULT 10,
	`isActive` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
INSERT INTO `products` (`name`, `category`, `prepMinutes`, `isActive`, `sortOrder`) VALUES
	('كرسبي', 'دجاج', 8, true, 10),
	('بروست', 'دجاج', 12, true, 20);
