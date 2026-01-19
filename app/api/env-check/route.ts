import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const MODEL_NAME = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

const isTruthy = (value?: string) => {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

export async function GET() {
  return NextResponse.json({
    node: process.version,
    has_key: Boolean(process.env.OPENAI_API_KEY),
    test_mode: isTruthy(process.env.META_TEST_MODE),
    model: MODEL_NAME
  });
}
