"use client";

export function ConnectComputerLink() {
  return (
    <a
      className="back-link"
      href="#connect-computer"
      onClick={(event) => {
        const panel = document.getElementById("connect-computer");
        if (panel instanceof HTMLDetailsElement) {
          event.preventDefault();
          panel.open = true;
          panel.querySelector("summary")?.focus();
          panel.scrollIntoView({ block: "start" });
        }
      }}
    >
      Connect a computer
    </a>
  );
}
