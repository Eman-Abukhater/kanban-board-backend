-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('admin', 'employee');

-- CreateTable
CREATE TABLE "public"."User" (
    "user_id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "public"."Role" NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "public"."SqlProject" (
    "project_id" SERIAL NOT NULL,
    "project_name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',

    CONSTRAINT "SqlProject_pkey" PRIMARY KEY ("project_id")
);

-- CreateTable
CREATE TABLE "public"."ProjectMember" (
    "member_id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" "public"."Role" NOT NULL,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("member_id")
);

-- CreateTable
CREATE TABLE "public"."Board" (
    "board_id" SERIAL NOT NULL,
    "fkboardid" TEXT NOT NULL,
    "project_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedby" TEXT NOT NULL,
    "addedbyid" INTEGER NOT NULL,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("board_id")
);

-- CreateTable
CREATE TABLE "public"."BoardMember" (
    "board_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "BoardMember_pkey" PRIMARY KEY ("board_id","user_id")
);

-- CreateTable
CREATE TABLE "public"."List" (
    "list_id" TEXT NOT NULL,
    "board_id" INTEGER NOT NULL,
    "list_name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "List_pkey" PRIMARY KEY ("list_id")
);

-- CreateTable
CREATE TABLE "public"."Card" (
    "card_id" TEXT NOT NULL,
    "list_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "image_url" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),

    CONSTRAINT "Card_pkey" PRIMARY KEY ("card_id")
);

-- CreateTable
CREATE TABLE "public"."Task" (
    "task_id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "task_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "assigned_to" INTEGER,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("task_id")
);

-- CreateTable
CREATE TABLE "public"."Tag" (
    "tag_id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "color" TEXT,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("tag_id")
);

-- CreateTable
CREATE TABLE "public"."Comment" (
    "comment_id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("comment_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Board_fkboardid_key" ON "public"."Board"("fkboardid");

-- AddForeignKey
ALTER TABLE "public"."ProjectMember" ADD CONSTRAINT "ProjectMember_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."SqlProject"("project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjectMember" ADD CONSTRAINT "ProjectMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Board" ADD CONSTRAINT "Board_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."SqlProject"("project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BoardMember" ADD CONSTRAINT "BoardMember_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."Board"("board_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BoardMember" ADD CONSTRAINT "BoardMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."List" ADD CONSTRAINT "List_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."Board"("board_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Card" ADD CONSTRAINT "Card_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "public"."List"("list_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."Card"("card_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."User"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Tag" ADD CONSTRAINT "Tag_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."Card"("card_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Comment" ADD CONSTRAINT "Comment_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."Card"("card_id") ON DELETE RESTRICT ON UPDATE CASCADE;
