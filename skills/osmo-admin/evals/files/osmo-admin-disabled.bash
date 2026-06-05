osmo() {
  printf '%s\n' 'osmo CLI disabled in osmo-admin eval fixture; use provided config files' >&2
  return 2
}

kubectl() {
  printf '%s\n' 'kubectl disabled in osmo-admin eval fixture; live mutation is out of scope' >&2
  return 2
}
