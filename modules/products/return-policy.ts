export type ProductReturnFlag = boolean;

export function returnPolicyLabel(returnAvailable: ProductReturnFlag) {
  return returnAvailable ? "Return Available" : "No Return";
}

export function summarizeReturnPolicy(flags: ProductReturnFlag[]) {
  if (!flags.length) return { kind: "none" as const, label: "No Return" };
  const allAvailable = flags.every(Boolean);
  const allNone = flags.every((flag) => !flag);
  if (allAvailable) return { kind: "available" as const, label: "Return Available" };
  if (allNone) return { kind: "none" as const, label: "No Return" };
  return { kind: "mixed" as const, label: "Mixed — see items" };
}
