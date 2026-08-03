/**
 * Mock Supabase Client
 * 
 * Provides a mock implementation of Supabase client for development
 * until the real Supabase database is ready.
 * 
 * This mock returns realistic responses that match Supabase API structure.
 */

export const mockSupabase = {
  from: (table: string) => ({
    select: (columns?: string) => ({
      eq: (column: string, value: any) => ({
        single: async () => {
          console.log(`[MOCK] SELECT ${columns || "*"} FROM ${table} WHERE ${column} = ${value}`);
          return {
            data: null,
            error: { message: "Mock: Data not available yet. Using localStorage." },
          };
        },
        then: async (resolve: any) => {
          console.log(`[MOCK] SELECT ${columns || "*"} FROM ${table} WHERE ${column} = ${value}`);
          resolve({
            data: [],
            error: null,
          });
        },
      }),
      in: (column: string, values: any[]) => ({
        then: async (resolve: any) => {
          console.log(`[MOCK] SELECT ${columns || "*"} FROM ${table} WHERE ${column} IN [${values.join(", ")}]`);
          resolve({
            data: [],
            error: null,
          });
        },
      }),
      order: (column: string, options?: any) => ({
        then: async (resolve: any) => {
          console.log(`[MOCK] SELECT ${columns || "*"} FROM ${table} ORDER BY ${column}`);
          resolve({
            data: [],
            error: null,
          });
        },
      }),
      then: async (resolve: any) => {
        console.log(`[MOCK] SELECT ${columns || "*"} FROM ${table}`);
        resolve({
          data: [],
          error: null,
        });
      },
    }),

    insert: (data: any) => ({
      select: () => ({
        single: async () => {
          console.log(`[MOCK] INSERT INTO ${table}`, data);
          return {
            data: { id: `mock-${Date.now()}`, ...data },
            error: null,
          };
        },
        then: async (resolve: any) => {
          console.log(`[MOCK] INSERT INTO ${table}`, data);
          resolve({
            data: [{ id: `mock-${Date.now()}`, ...data }],
            error: null,
          });
        },
      }),
      then: async (resolve: any) => {
        console.log(`[MOCK] INSERT INTO ${table}`, data);
        resolve({
          data: { id: `mock-${Date.now()}`, ...data },
          error: null,
        });
      },
    }),

    update: (data: any) => ({
      eq: (column: string, value: any) => ({
        select: () => ({
          then: async (resolve: any) => {
            console.log(`[MOCK] UPDATE ${table} SET ... WHERE ${column} = ${value}`, data);
            resolve({
              data: [{ ...data, id: value }],
              error: null,
            });
          },
        }),
        then: async (resolve: any) => {
          console.log(`[MOCK] UPDATE ${table} SET ... WHERE ${column} = ${value}`, data);
          resolve({
            data: null,
            error: null,
          });
        },
      }),
    }),

    delete: () => ({
      eq: (column: string, value: any) => ({
        then: async (resolve: any) => {
          console.log(`[MOCK] DELETE FROM ${table} WHERE ${column} = ${value}`);
          resolve({
            data: null,
            error: null,
          });
        },
      }),
    }),

    upsert: (data: any) => ({
      select: () => ({
        then: async (resolve: any) => {
          console.log(`[MOCK] UPSERT INTO ${table}`, data);
          resolve({
            data: Array.isArray(data) 
              ? data.map((d, i) => ({ id: `mock-${Date.now()}-${i}`, ...d }))
              : [{ id: `mock-${Date.now()}`, ...data }],
            error: null,
          });
        },
      }),
      then: async (resolve: any) => {
        console.log(`[MOCK] UPSERT INTO ${table}`, data);
        resolve({
          data: null,
          error: null,
        });
      },
    }),
  }),

  // Auth mock (not used, Firebase handles auth)
  auth: {
    signIn: async (credentials: any) => {
      console.log("[MOCK] Auth sign in - Use Firebase instead");
      return { data: null, error: { message: "Use Firebase for authentication" } };
    },
    signOut: async () => {
      console.log("[MOCK] Auth sign out - Use Firebase instead");
      return { error: null };
    },
    getUser: async () => {
      console.log("[MOCK] Get user - Use Firebase instead");
      return { data: null, error: { message: "Use Firebase for authentication" } };
    },
  },

  // Storage mock (not used, Firebase handles storage)
  storage: {
    from: (bucket: string) => ({
      upload: async (path: string, file: File) => {
        console.log(`[MOCK] Upload to ${bucket}/${path} - Use Firebase Storage instead`);
        return { data: null, error: { message: "Use Firebase Storage instead" } };
      },
      download: async (path: string) => {
        console.log(`[MOCK] Download from ${bucket}/${path} - Use Firebase Storage instead`);
        return { data: null, error: { message: "Use Firebase Storage instead" } };
      },
      getPublicUrl: (path: string) => {
        console.log(`[MOCK] Get public URL for ${bucket}/${path} - Use Firebase Storage instead`);
        return { data: { publicUrl: "" } };
      },
    }),
  },
};

/**
 * Mock query builder for testing
 */
export class MockQueryBuilder {
  private table: string;
  private whereClause: string = "";

  constructor(table: string) {
    this.table = table;
  }

  select(columns?: string) {
    console.log(`[MOCK QUERY] SELECT ${columns || "*"} FROM ${this.table}`);
    return this;
  }

  eq(column: string, value: any) {
    this.whereClause = `WHERE ${column} = ${value}`;
    console.log(`[MOCK QUERY] ${this.whereClause}`);
    return this;
  }

  async single() {
    console.log(`[MOCK QUERY] Executing single row query`);
    return { data: null, error: null };
  }

  async then(resolve: any) {
    console.log(`[MOCK QUERY] Executing query`);
    resolve({ data: [], error: null });
  }
}

/**
 * Helper to log mock database operations
 */
export function logMockOperation(operation: string, table: string, details?: any) {
  console.log(`%c[MOCK SUPABASE]`, "color: orange; font-weight: bold", operation, table, details || "");
}
