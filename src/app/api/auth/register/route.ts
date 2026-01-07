import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { z } from "zod";

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required").optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, name } = registerSchema.parse(body);

    // Check if user already exists
    const existingUser = await db.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 400 }
      );
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    
    const user = await db.user.create({
      data: {
        email,
        name,
        passwordHash,
      },
    });

    // Create default "Personal" entity for the new user
    await db.entity.create({
      data: {
        userId: user.id,
        type: "PERSON",
        name: "Personal",
        isDefault: true,
      },
    });

    // Create default categories for the new user
    const defaultCategories = [
      { name: 'Salary', icon: '💰', defaultClassification: 'INCOME' as const },
      { name: 'Freelance', icon: '💼', defaultClassification: 'INCOME' as const },
      { name: 'Investments', icon: '📈', defaultClassification: 'INCOME' as const },
      { name: 'Materials', icon: '📦', defaultClassification: 'COGS' as const },
      { name: 'Inventory', icon: '🏪', defaultClassification: 'COGS' as const },
      { name: 'Shipping', icon: '🚚', defaultClassification: 'COGS' as const },
      { name: 'Rent', icon: '🏢', defaultClassification: 'OPERATING' as const },
      { name: 'Utilities', icon: '⚡', defaultClassification: 'OPERATING' as const },
      { name: 'Software & Tools', icon: '🔧', defaultClassification: 'OPERATING' as const },
      { name: 'Marketing', icon: '📣', defaultClassification: 'OPERATING' as const },
      { name: 'Groceries', icon: '🛒', defaultClassification: 'PERSONAL' as const },
      { name: 'Dining Out', icon: '🍽️', defaultClassification: 'PERSONAL' as const },
      { name: 'Entertainment', icon: '🎬', defaultClassification: 'PERSONAL' as const },
      { name: 'Transportation', icon: '🚗', defaultClassification: 'PERSONAL' as const },
      { name: 'Healthcare', icon: '🏥', defaultClassification: 'PERSONAL' as const },
      { name: 'Shopping', icon: '🛍️', defaultClassification: 'PERSONAL' as const },
      { name: 'Transfer', icon: '↔️', defaultClassification: 'TRANSFER' as const },
      { name: 'Uncategorized', icon: '❓', defaultClassification: null },
    ];

    await db.category.createMany({
      data: defaultCategories.map((cat) => ({
        userId: user.id,
        name: cat.name,
        icon: cat.icon,
        defaultClassification: cat.defaultClassification,
        isSystem: true,
      })),
    });

    return NextResponse.json(
      { message: "Account created successfully" },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      );
    }

    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "An error occurred during registration" },
      { status: 500 }
    );
  }
}
