import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Win95 window chrome.
 *
 * The title-bar buttons are decorative unless a handler is passed. They render
 * as aria-hidden in that case so assistive tech doesn't announce controls that
 * do nothing — the look survives, the lie doesn't.
 */

function TitleBarButton({
  label,
  glyph,
  onClick,
}: {
  label: string;
  glyph: ReactNode;
  onClick?: (() => void) | undefined;
}) {
  const shared =
    "grid h-[16px] w-[17px] place-items-center bevel-out !border-[1px] p-0 text-[10px] leading-none font-bold text-black active:bevel-pressed";

  if (!onClick) {
    return (
      <span aria-hidden="true" className={shared}>
        {glyph}
      </span>
    );
  }
  return (
    <button type="button" aria-label={label} onClick={onClick} className={shared}>
      {glyph}
    </button>
  );
}

export function TitleBar({
  title,
  icon,
  active = true,
  onClose,
  onMinimize,
  onMaximize,
}: {
  title: string;
  icon?: ReactNode;
  active?: boolean;
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 px-1 py-[2px] select-none",
        active ? "title-bar" : "title-bar-inactive",
      )}
    >
      {icon ? <span className="grid size-4 shrink-0 place-items-center">{icon}</span> : null}
      <span className="flex-1 truncate text-[11px] tracking-tight">{title}</span>
      <div className="flex shrink-0 items-center gap-[2px]">
        <TitleBarButton label="Minimize" glyph="_" onClick={onMinimize} />
        <TitleBarButton label="Maximize" glyph="□" onClick={onMaximize} />
        <TitleBarButton label="Close" glyph="✕" onClick={onClose} />
      </div>
    </div>
  );
}

export function MenuBar({ items }: { items: string[] }) {
  return (
    <div className="flex items-center gap-0 border-b border-b-w95-shadow bg-w95-face px-1 py-[2px]">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          className="px-2 py-[1px] text-[11px] text-black hover:bg-w95-title hover:text-white"
        >
          <span className="underline decoration-1 underline-offset-2">{item.charAt(0)}</span>
          {item.slice(1)}
        </button>
      ))}
    </div>
  );
}

export function StatusBar({ panels }: { panels: ReactNode[] }) {
  return (
    <div className="flex items-stretch gap-[2px] bg-w95-face px-[2px] py-[2px]">
      {panels.map((panel, i) => (
        <div
          key={i}
          className={cn(
            "bevel-in-thin truncate px-2 py-[2px] text-[11px] text-black",
            i === 0 ? "flex-1" : "shrink-0",
          )}
        >
          {panel}
        </div>
      ))}
    </div>
  );
}

export function Win95Window({
  title,
  icon,
  menu,
  status,
  onClose,
  onMinimize,
  onMaximize,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  icon?: ReactNode;
  menu?: string[];
  status?: ReactNode[];
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("bevel-out flex flex-col p-[3px]", className)}>
      <TitleBar
        title={title}
        {...(icon !== undefined ? { icon } : {})}
        {...(onClose !== undefined ? { onClose } : {})}
        {...(onMinimize !== undefined ? { onMinimize } : {})}
        {...(onMaximize !== undefined ? { onMaximize } : {})}
      />
      {menu ? <MenuBar items={menu} /> : null}
      <div className={cn("flex-1", bodyClassName)}>{children}</div>
      {status ? <StatusBar panels={status} /> : null}
    </div>
  );
}

/** Win95 group box — a labelled hairline frame around related controls. */
export function GroupBox({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className={cn("bevel-in-thin px-3 pt-2 pb-3", className)}>
      <legend className="px-1 text-[11px] text-black">{label}</legend>
      {children}
    </fieldset>
  );
}
