import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { pool } from "../src/db";

describe("GET /api/health", () => {
  it("responde ok:true sem precisar de autenticação", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, service: "flexia-hub-api" });
  });
});

afterAll(async () => {
  await pool.end();
});
