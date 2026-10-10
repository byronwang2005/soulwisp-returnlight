export function postgresEnvironment(connection, environment=process.env) {
  const url=new URL(connection);
  if(!['postgres:', 'postgresql:'].includes(url.protocol))throw new Error('Expected a PostgreSQL connection URL.');
  const name=decodeURIComponent(url.pathname.slice(1));
  if(!name||url.pathname.slice(1).includes('/'))throw new Error('A database name is required.');
  return {...environment,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:name,...(url.searchParams.has('sslmode')?{PGSSLMODE:url.searchParams.get('sslmode')}:{})};
}
export function sameDatabase(left,right) {
  const a=postgresEnvironment(left),b=postgresEnvironment(right);
  const host=value=>['localhost','127.0.0.1','::1'].includes(value)?'loopback':value.toLowerCase();
  return host(a.PGHOST)===host(b.PGHOST)&&a.PGPORT===b.PGPORT&&a.PGDATABASE===b.PGDATABASE;
}
