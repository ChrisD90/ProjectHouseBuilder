/** Replace the SVG files in static/branding; no source changes are needed. */
export function BrandLogo() {
  return (
    <span>
      <img
        className="brand-logo brand-logo-light"
        src="/static/branding/logo-light.svg"
        alt="ProjectHouseBuilder"
      />
      <img
        className="brand-logo brand-logo-dark"
        src="/static/branding/logo-dark.svg"
        alt="ProjectHouseBuilder"
      />
    </span>
  );
}
