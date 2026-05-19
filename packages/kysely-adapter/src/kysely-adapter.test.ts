import { DatabaseSync } from "node:sqlite";
import { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { D1SqliteDialect } from "./d1-sqlite-dialect";
import { createKyselyAdapter } from "./dialect";
import { kyselyAdapter } from "./kysely-adapter";
import { NodeSqliteDialect } from "./node-sqlite-dialect";

describe("kysely-adapter", () => {
	class UnknownDialect {
		createAdapter() {
			return {
				supportsTransactionalDdl: () => false,
				supportsReturning: false,
				supportsCreateIfNotExists: true,
				supportsOutput: false,
				acquireMigrationLock: async () => {},
				releaseMigrationLock: async () => {},
			};
		}

		createDriver() {
			return {
				async init() {},
				async acquireConnection() {
					return {
						async executeQuery() {
							return { rows: [] };
						},
						async *streamQuery() {},
					};
				},
				async beginTransaction() {},
				async commitTransaction() {},
				async rollbackTransaction() {},
				async releaseConnection() {},
				async destroy() {},
			};
		}

		createIntrospector(db: Kysely<any>) {
			return db.introspection;
		}

		createQueryCompiler() {
			return {
				compileQuery() {
					return { sql: "", parameters: [] };
				},
			};
		}
	}

	it("should create kysely adapter", () => {
		const db = new Kysely({
			dialect: new NodeSqliteDialect({
				database: {
					close: () => {},
					prepare: () =>
						({
							all: () => [],
							run: () => {},
							get: () => {},
							iterate: () => [],
						}) as any,
				} as any,
			}),
		});
		const adapter = kyselyAdapter(db);
		expect(adapter).toBeDefined();
	});

	it("should enable transactions by default for node:sqlite databases", async () => {
		const sqlite = new DatabaseSync(":memory:");
		const adapter = await createKyselyAdapter({
			database: sqlite,
		} as never);

		expect(adapter.transaction).toBe(true);
	});

	it("should enable transactions by default for Kysely sqlite instances", async () => {
		const db = new Kysely({
			dialect: new NodeSqliteDialect({
				database: new DatabaseSync(":memory:"),
			}),
		});

		const adapter = await createKyselyAdapter({
			database: {
				db,
				type: "sqlite",
			},
		} as never);

		expect(adapter.transaction).toBe(true);
	});

	it("should respect an explicit transaction opt-out", async () => {
		const db = new Kysely({
			dialect: new NodeSqliteDialect({
				database: new DatabaseSync(":memory:"),
			}),
		});

		const adapter = await createKyselyAdapter({
			database: {
				db,
				type: "sqlite",
				transaction: false,
			},
		} as never);

		expect(adapter.transaction).toBe(false);
	});

	it("should keep transactions disabled for D1 databases", async () => {
		const adapter = await createKyselyAdapter({
			database: {
				batch: async () => [],
				exec: async () => ({ count: 0, duration: 0 }),
				prepare: () => ({
					bind: () => ({
						all: async () => ({
							results: [],
							success: true,
							meta: { duration: 0 },
						}),
						first: async () => null,
						run: async () => ({
							success: true,
							meta: {
								duration: 0,
								changes: 0,
								last_row_id: 0,
								rows_read: 0,
								rows_written: 0,
								size_after: 0,
							},
						}),
						raw: async () => [],
					}),
				}),
			},
		} as never);

		expect(adapter.transaction).toBe(false);
	});

	it("should keep transactions disabled for D1 dialect instances", async () => {
		const d1Database = {
			batch: async () => [],
			exec: async () => ({ count: 0, duration: 0 }),
			prepare: () => ({
				bind: () => ({
					all: async () => ({
						results: [],
						success: true,
						meta: { duration: 0 },
					}),
					first: async () => null,
					run: async () => ({
						success: true,
						meta: {
							duration: 0,
							changes: 0,
							last_row_id: 0,
							rows_read: 0,
							rows_written: 0,
							size_after: 0,
						},
					}),
					raw: async () => [],
				}),
			}),
		};

		const adapter = await createKyselyAdapter({
			database: {
				dialect: new D1SqliteDialect({
					database: d1Database as never,
				}),
				type: "sqlite",
			},
		} as never);

		expect(adapter.transaction).toBe(false);
	});

	it("should not infer transactions for unknown custom dialects", async () => {
		const adapter = await createKyselyAdapter({
			database: {
				dialect: new UnknownDialect() as never,
				type: "sqlite",
			},
		} as never);

		expect(adapter.transaction).toBeUndefined();
	});

	it("consumeOne deletes only the selected row for non-unique predicates", async () => {
		const selectQuery = {
			select: vi.fn(() => selectQuery),
			where: vi.fn(() => selectQuery),
			limit: vi.fn(() => selectQuery),
		};
		const deleted = {
			id: "verification-1",
			identifier: "same-identifier",
			value: "first",
		};
		const deleteQuery = {
			where: vi.fn(() => deleteQuery),
			returningAll: vi.fn(() => deleteQuery),
			executeTakeFirst: vi.fn().mockResolvedValue(deleted),
		};
		const db = {
			selectFrom: vi.fn(() => selectQuery),
			deleteFrom: vi.fn(() => deleteQuery),
		} as any;
		const adapter = kyselyAdapter(db)({});

		const result = await adapter.consumeOne({
			model: "verification",
			where: [{ field: "identifier", value: "same-identifier" }],
		});

		expect(result).toEqual(deleted);
		expect(selectQuery.select).toHaveBeenCalledWith("verification.id");
		expect(selectQuery.where).toHaveBeenCalledTimes(1);
		expect(deleteQuery.where).toHaveBeenCalledTimes(1);
		expect(deleteQuery.where).toHaveBeenCalledWith(
			"verification.id",
			"in",
			selectQuery,
		);
		expect(deleteQuery.returningAll).toHaveBeenCalledTimes(1);
	});
});
