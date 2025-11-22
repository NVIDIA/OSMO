import { FilledIcon } from "./Icon";

export const IconButton = ({
  icon,
  text,
  alwaysShowText = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; text?: string; alwaysShowText?: boolean }) => {
  return (
    <button {...props}>
      <FilledIcon name={icon} />
      {text && (
        <span
          className={`${alwaysShowText ? "block" : "hidden lg:block"}`}
          aria-label={text}
        >
          {text}
        </span>
      )}
      {props.children}
    </button>
  );
};
