-- AlterTable
ALTER TABLE "firms" ADD COLUMN "homeModule" TEXT;

-- Backfill: a firm that runs IPM without HR is not an HR firm. Its dashboard
-- and decision queue only ever counted employees it does not have.
UPDATE "firms" f
SET "homeModule" = 'ipm'
WHERE EXISTS (
    SELECT 1 FROM "firm_modules" fm JOIN "modules" m ON m."id" = fm."moduleId"
    WHERE fm."firmId" = f."id" AND fm."isEnabled" AND m."slug" = 'ipm'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "firm_modules" fm JOIN "modules" m ON m."id" = fm."moduleId"
    WHERE fm."firmId" = f."id" AND fm."isEnabled" AND m."slug" = 'hr'
  );
