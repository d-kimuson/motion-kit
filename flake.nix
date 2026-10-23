{
  description = "motion-kit development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems =
        f:
        nixpkgs.lib.genAttrs systems (
          system:
          f (
            import nixpkgs {
              inherit system;
            }
          )
        );
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            # Keep in sync with .node-version (even-numbered Node releases).
            pkgs.nodejs_26
            pkgs.pnpm
            pkgs.gitleaks
            # Lean toolchain manager; `lake build` fetches the version in lean-toolchain on first run.
            pkgs.elan
          ];

          shellHook = ''
            echo "motion-kit dev shell"
            echo "  node  $(node --version)"
            echo "  pnpm  $(pnpm --version)"
          '';
        };
      });
    };
}
