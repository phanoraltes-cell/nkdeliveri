import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:rounded-2xl group-[.toaster]:border group-[.toaster]:border-brand-soft/50 group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:shadow-brand-md",
          description: "group-[.toast]:text-ink-soft",
          actionButton:
            "group-[.toast]:rounded-full group-[.toast]:bg-brand group-[.toast]:text-white group-[.toast]:font-bold",
          cancelButton:
            "group-[.toast]:rounded-full group-[.toast]:bg-brand-soft/60 group-[.toast]:text-brand-deep",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
