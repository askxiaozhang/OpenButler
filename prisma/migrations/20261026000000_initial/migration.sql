-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MemberKind" AS ENUM ('PERSON', 'PET');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "Source" AS ENUM ('MANUAL', 'AI', 'RECURRENCE');

-- CreateEnum
CREATE TYPE "Freq" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'ONCE');

-- CreateEnum
CREATE TYPE "AnchorOn" AS ENUM ('LAST_DONE', 'FIXED_SCHEDULE');

-- CreateEnum
CREATE TYPE "ChatChannel" AS ENUM ('WEB', 'SHORTCUT', 'QQ_PRIVATE', 'QQ_GROUP');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "ChatProposalStatus" AS ENUM ('PENDING', 'APPLYING', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "memberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductDocument" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "chatMessageId" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "pageCount" INTEGER,
    "extractedText" TEXT NOT NULL DEFAULT '',
    "textPages" JSONB NOT NULL DEFAULT '[]',
    "visionPages" JSONB NOT NULL DEFAULT '[]',
    "indexStatus" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductNote" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "documentId" TEXT,
    "pageNumber" INTEGER,
    "content" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kind" "MemberKind" NOT NULL DEFAULT 'PERSON',
    "emoji" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Record" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT,
    "assigneeId" TEXT,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "occurredOn" DATE NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "authorId" TEXT,
    "taskId" TEXT,
    "recurrenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recurrence" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "freq" "Freq" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "anchorOn" "AnchorOn" NOT NULL DEFAULT 'LAST_DONE',
    "anchorDate" DATE NOT NULL,
    "timeOfDay" TEXT NOT NULL DEFAULT '09:00',
    "reminderTime" TEXT,
    "nextCursorOn" DATE NOT NULL,
    "lastDoneOn" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT,
    "assigneeId" TEXT,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "dueOn" DATE NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "reminderAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "qqReminderSentAt" TIMESTAMP(3),
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "authorId" TEXT,
    "recurrenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "channel" "ChatChannel" NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "sourceKey" TEXT,
    "proposal" JSONB,
    "proposalStatus" "ChatProposalStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QqBinding" (
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT false,
    "remindersEnabledAt" TIMESTAMP(3),
    "reminderLastError" TEXT,
    "reminderLastSentAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "lookupKey" TEXT NOT NULL,
    "openId" TEXT NOT NULL,
    "groupId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QqBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QqPairingCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QqPairingCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortcutCredential" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ShortcutCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDelivery" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sentOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QqReminderDelivery" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "reminderAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "claimToken" TEXT NOT NULL,
    "leaseUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QqReminderDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_memberId_key" ON "User"("memberId");

-- CreateIndex
CREATE INDEX "Product_updatedAt_id_idx" ON "Product"("updatedAt" DESC, "id");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE UNIQUE INDEX "ProductDocument_storagePath_key" ON "ProductDocument"("storagePath");

-- CreateIndex
CREATE INDEX "ProductDocument_productId_ready_createdAt_idx" ON "ProductDocument"("productId", "ready", "createdAt");

-- CreateIndex
CREATE INDEX "ProductDocument_uploadedBy_ready_createdAt_idx" ON "ProductDocument"("uploadedBy", "ready", "createdAt");

-- CreateIndex
CREATE INDEX "ProductDocument_chatMessageId_idx" ON "ProductDocument"("chatMessageId");

-- CreateIndex
CREATE INDEX "ProductNote_productId_createdAt_idx" ON "ProductNote"("productId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ProductNote_documentId_idx" ON "ProductNote"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "Member_name_key" ON "Member"("name");

-- CreateIndex
CREATE INDEX "Member_archivedAt_sortOrder_idx" ON "Member"("archivedAt", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Record_taskId_key" ON "Record"("taskId");

-- CreateIndex
CREATE INDEX "Record_subjectId_occurredOn_idx" ON "Record"("subjectId", "occurredOn" DESC);

-- CreateIndex
CREATE INDEX "Record_assigneeId_occurredOn_idx" ON "Record"("assigneeId", "occurredOn" DESC);

-- CreateIndex
CREATE INDEX "Record_occurredOn_idx" ON "Record"("occurredOn" DESC);

-- CreateIndex
CREATE INDEX "Recurrence_active_nextCursorOn_idx" ON "Recurrence"("active", "nextCursorOn");

-- CreateIndex
CREATE UNIQUE INDEX "Recurrence_subjectId_title_key" ON "Recurrence"("subjectId", "title");

-- CreateIndex
CREATE INDEX "Task_status_dueOn_idx" ON "Task"("status", "dueOn");

-- CreateIndex
CREATE INDEX "Task_status_reminderAt_idx" ON "Task"("status", "reminderAt");

-- CreateIndex
CREATE INDEX "Task_subjectId_status_dueOn_idx" ON "Task"("subjectId", "status", "dueOn");

-- CreateIndex
CREATE INDEX "Task_assigneeId_status_dueOn_idx" ON "Task"("assigneeId", "status", "dueOn");

-- CreateIndex
CREATE INDEX "Task_dueOn_idx" ON "Task"("dueOn");

-- CreateIndex
CREATE UNIQUE INDEX "Task_recurrenceId_dueOn_key" ON "Task"("recurrenceId", "dueOn");

-- CreateIndex
CREATE UNIQUE INDEX "ChatSession_scope_key" ON "ChatSession"("scope");

-- CreateIndex
CREATE INDEX "ChatSession_userId_updatedAt_idx" ON "ChatSession"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_sourceKey_key" ON "ChatMessage"("sourceKey");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_proposalStatus_createdAt_idx" ON "ChatMessage"("sessionId", "proposalStatus", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "QqBinding_lookupKey_key" ON "QqBinding"("lookupKey");

-- CreateIndex
CREATE INDEX "QqBinding_userId_createdAt_idx" ON "QqBinding"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QqPairingCode_codeHash_key" ON "QqPairingCode"("codeHash");

-- CreateIndex
CREATE INDEX "QqPairingCode_userId_expiresAt_idx" ON "QqPairingCode"("userId", "expiresAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ShortcutCredential_tokenHash_key" ON "ShortcutCredential"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ShortcutCredential_userId_key" ON "ShortcutCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_updatedAt_idx" ON "PushSubscription"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "PushDelivery_sentOn_idx" ON "PushDelivery"("sentOn");

-- CreateIndex
CREATE UNIQUE INDEX "PushDelivery_subscriptionId_taskId_sentOn_key" ON "PushDelivery"("subscriptionId", "taskId", "sentOn");

-- CreateIndex
CREATE UNIQUE INDEX "QqReminderDelivery_groupId_taskId_reminderAt_key" ON "QqReminderDelivery"("groupId", "taskId", "reminderAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDocument" ADD CONSTRAINT "ProductDocument_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDocument" ADD CONSTRAINT "ProductDocument_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductNote" ADD CONSTRAINT "ProductNote_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductNote" ADD CONSTRAINT "ProductNote_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProductDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductNote" ADD CONSTRAINT "ProductNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "Recurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recurrence" ADD CONSTRAINT "Recurrence_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recurrence" ADD CONSTRAINT "Recurrence_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "Recurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QqBinding" ADD CONSTRAINT "QqBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QqPairingCode" ADD CONSTRAINT "QqPairingCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortcutCredential" ADD CONSTRAINT "ShortcutCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QqReminderDelivery" ADD CONSTRAINT "QqReminderDelivery_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Server-side session auth only. No household data is exposed via the Supabase Data API.
ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."User" FROM PUBLIC;
ALTER TABLE public."Product" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Product" FROM PUBLIC;
ALTER TABLE public."ProductDocument" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."ProductDocument" FROM PUBLIC;
ALTER TABLE public."ProductNote" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."ProductNote" FROM PUBLIC;
ALTER TABLE public."Member" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Member" FROM PUBLIC;
ALTER TABLE public."Record" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Record" FROM PUBLIC;
ALTER TABLE public."Recurrence" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Recurrence" FROM PUBLIC;
ALTER TABLE public."Task" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Task" FROM PUBLIC;
ALTER TABLE public."ChatSession" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."ChatSession" FROM PUBLIC;
ALTER TABLE public."ChatMessage" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."ChatMessage" FROM PUBLIC;
ALTER TABLE public."QqBinding" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."QqBinding" FROM PUBLIC;
ALTER TABLE public."QqPairingCode" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."QqPairingCode" FROM PUBLIC;
ALTER TABLE public."ShortcutCredential" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."ShortcutCredential" FROM PUBLIC;
ALTER TABLE public."PushSubscription" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."PushSubscription" FROM PUBLIC;
ALTER TABLE public."PushDelivery" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."PushDelivery" FROM PUBLIC;
ALTER TABLE public."QqReminderDelivery" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."QqReminderDelivery" FROM PUBLIC;
DO $privacy$
DECLARE app_table text; api_role text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY['User','Product','ProductDocument','ProductNote','Member','Record','Recurrence','Task','ChatSession','ChatMessage','QqBinding','QqPairingCode','ShortcutCredential','PushSubscription','PushDelivery','QqReminderDelivery'] LOOP
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', app_table, api_role);
      END IF;
    END LOOP;
  END LOOP;
END;
$privacy$;
