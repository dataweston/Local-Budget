const requiredDatabaseUrls = ['DATABASE_URL', 'DIRECT_URL'];
const errors = [];

for (const name of requiredDatabaseUrls) {
  const value = process.env[name]?.trim();

  if (!value) {
    errors.push(`${name} is missing or empty`);
    continue;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
      errors.push(`${name} must use the postgres:// or postgresql:// protocol`);
    }
  } catch {
    errors.push(`${name} is not a valid PostgreSQL URL`);
  }
}

if (errors.length > 0) {
  console.error(`Database environment is invalid:\n- ${errors.join('\n- ')}`);
  console.error(
    'Set DATABASE_URL to the pooled runtime URL and DIRECT_URL to the direct migration URL.',
  );
  process.exit(1);
}

console.log('Database environment is configured.');
