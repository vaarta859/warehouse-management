-- CreateEnum
CREATE TYPE "SerialMode" AS ENUM ('REQUIRED', 'NOT_REQUIRED', 'OPTIONAL');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "serialMode" "SerialMode" NOT NULL DEFAULT 'REQUIRED';
