"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  const errorMessages: Record<string, string> = {
    OAuthSignin: "Wystąpił problem z logowaniem przez Google.",
    OAuthCallback: "Wystąpił problem z odpowiedzią od Google.",
    OAuthAccountNotLinked: "To konto jest już powiązane z inną metodą logowania.",
    AccessDenied: "Brak dostępu. Twój email nie znajduje się na liście dozwolonych.",
    default: "Wystąpił nieoczekiwany błąd. Spróbuj ponownie.",
  };

  const errorMessage = error
    ? errorMessages[error] || errorMessages.default
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)] px-4">
      <div
        className="w-full max-w-sm rounded-2xl bg-[var(--card)] p-8"
        style={{ boxShadow: "var(--card-shadow)" }}
      >
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🏋️</div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
            PapiCoach
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Twój osobisty system transformacji
          </p>
        </div>

        {/* Error */}
        {errorMessage && (
          <div className="mb-6 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        {/* Google Sign In */}
        <button
          onClick={() => signIn("google", { callbackUrl: "/" })}
          className="w-full flex items-center justify-center gap-3 rounded-xl bg-[var(--foreground)] text-white px-4 py-3 text-sm font-medium transition-opacity hover:opacity-90 active:opacity-80"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Zaloguj się przez Google
        </button>

        <p className="text-xs text-center text-[var(--muted)] mt-6">
          Dostęp tylko dla zaproszonych użytkowników
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
