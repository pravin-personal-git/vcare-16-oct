-- MAALIK OS 1.0.14+ rings Urgent alerts like a call (6 Oct 2026). Additive.
ALTER TABLE "PushToken" ADD COLUMN IF NOT EXISTS "fullScreen" BOOLEAN NOT NULL DEFAULT false;
