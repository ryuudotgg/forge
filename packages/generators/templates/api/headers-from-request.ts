function headersFromRequest(headers: __REQUEST_TYPE__["headers"]) {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;

    if (Array.isArray(value))
      for (const item of value) result.append(name, item);
    else result.set(name, value);
  }

  return result;
}
