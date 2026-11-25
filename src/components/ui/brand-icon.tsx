import brandIcon from "../../../docs/assets/icon.svg?no-inline";

export function BrandIcon({ size }: { size: number }) {
  return <svg className="brand-icon shrink-0 text-primary" aria-hidden="true"
    width={size} height={size} viewBox="0 0 128 128">
    <use href={`${brandIcon}#brand-mark`} />
  </svg>;
}
