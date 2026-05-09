import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import type { JWT } from "@auth/core/jwt";
import type { Session, Account } from "@auth/core/types";

// next-auth v5 beta: default export is not callable in TS bundler moduleResolution mode.
// Bypass via any cast. Runtime behaviour is correct.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const init = NextAuth as any;

export const { handlers, auth, signIn, signOut } = init({
  providers: [GitHub],
  callbacks: {
    jwt({
      token,
      account,
    }: {
      token: JWT;
      account: Account | null;
    }): JWT {
      // Persist the provider account id to the token on first sign-in.
      if (account) {
        token.sub = account.providerAccountId;
      }
      return token;
    },
    session({
      session,
      token,
    }: {
      session: Session;
      token: JWT;
    }): Session {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});
