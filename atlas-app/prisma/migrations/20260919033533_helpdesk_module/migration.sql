-- CreateTable
CREATE TABLE "HelpdeskCategory" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "HelpdeskCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpdeskTicket" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "ticketNo" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "categoryId" TEXT,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'open',
    "assignedToId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpdeskTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpdeskComment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "body" TEXT,
    "statusFrom" TEXT,
    "statusTo" TEXT,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HelpdeskComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HelpdeskCategory_storeId_sortOrder_idx" ON "HelpdeskCategory"("storeId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "HelpdeskCategory_storeId_name_key" ON "HelpdeskCategory"("storeId", "name");

-- CreateIndex
CREATE INDEX "HelpdeskTicket_storeId_status_idx" ON "HelpdeskTicket"("storeId", "status");

-- CreateIndex
CREATE INDEX "HelpdeskTicket_storeId_raisedById_idx" ON "HelpdeskTicket"("storeId", "raisedById");

-- CreateIndex
CREATE INDEX "HelpdeskComment_ticketId_createdAt_idx" ON "HelpdeskComment"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "HelpdeskCategory" ADD CONSTRAINT "HelpdeskCategory_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpdeskTicket" ADD CONSTRAINT "HelpdeskTicket_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpdeskTicket" ADD CONSTRAINT "HelpdeskTicket_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpdeskTicket" ADD CONSTRAINT "HelpdeskTicket_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "HelpdeskCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpdeskTicket" ADD CONSTRAINT "HelpdeskTicket_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpdeskComment" ADD CONSTRAINT "HelpdeskComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "HelpdeskTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
