// The public flag only controls the UI; the API also enforces the server-only acceptance flag.
export function officialAiAvailable() {
  return process.env.NEXT_PUBLIC_STAGE4A_ACCEPTANCE === 'true';
}

export function officialAiServerAvailable(env = process.env) {
  return env.STAGE4A_ACCEPTANCE === 'true'
    && env.NEXTAUTH_URL === 'http://127.0.0.1:3010'
    && env.NEXT_PUBLIC_STAGE4A_ACCEPTANCE === 'true';
}
