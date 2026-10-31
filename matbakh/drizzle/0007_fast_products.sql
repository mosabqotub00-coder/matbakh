ALTER TABLE `products`
  ADD COLUMN `hasTimer` boolean NOT NULL DEFAULT true AFTER `graceMinutes`;
--> statement-breakpoint
ALTER TABLE `kitchenOrderItems`
  ADD COLUMN `hasTimer` boolean NOT NULL DEFAULT true AFTER `graceMinutes`;
--> statement-breakpoint
INSERT IGNORE INTO `products` (`branchId`, `name`, `category`, `prepMinutes`, `graceMinutes`, `hasTimer`, `isActive`, `sortOrder`)
SELECT b.`id`, p.`name`, 'إضافات سريعة', 0, 0, false, true, 900
FROM `branches` b
CROSS JOIN (
  SELECT 'ظرف ملفوف' AS `name`
  UNION ALL SELECT 'ظرف ثومة'
  UNION ALL SELECT 'ظرف شطة'
  UNION ALL SELECT 'علبة صوص'
  UNION ALL SELECT 'صوص ملكي'
  UNION ALL SELECT 'صوص سويت'
) p;
