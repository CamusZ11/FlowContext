import { fireEvent, render, screen } from "@testing-library/react";
import { DateSelector } from "./DateSelector";

describe("DateSelector", () => {
  it.each(["web", "desktop"] as const)("allows date selection in %s mode", (mode) => {
    const onChange = vi.fn();
    const { container } = render(<DateSelector mode={mode} value="2026-08-02" onChange={onChange} />);
    const input = container.querySelector('input[type="date"]')!;
    fireEvent.change(input, { target: { value: "2026-08-05" } });
    expect(onChange).toHaveBeenCalledWith("2026-08-05");
  });

  it("keeps the fallback date input out of keyboard and accessibility navigation", () => {
    const { container } = render(<DateSelector mode="desktop" value="2026-08-02" onChange={vi.fn()} />);
    const input = container.querySelector('input[type="date"]');

    expect(input).toHaveAttribute("tabindex", "-1");
    expect(input).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByRole("button", { name: "选择日期，当前 2026-08-02" })).toHaveLength(1);
    expect(screen.queryByLabelText("选择日期")).not.toBeInTheDocument();
  });

  it("opens its date input from the compact date trigger", () => {
    const { container } = render(<DateSelector mode="desktop" value="2026-08-02" onChange={vi.fn()} />);
    const input = container.querySelector('input[type="date"]') as HTMLInputElement & { showPicker?: () => void };
    input.showPicker = vi.fn();

    fireEvent.click(screen.getByRole("button", { name: "选择日期，当前 2026-08-02" }));

    expect(input.showPicker).toHaveBeenCalledOnce();
  });

  it("falls back to clicking the native input when showPicker is unavailable", () => {
    const { container } = render(<DateSelector mode="web" value="2026-08-02" onChange={vi.fn()} />);
    const input = container.querySelector('input[type="date"]') as HTMLInputElement & { showPicker?: () => void };
    const click = vi.spyOn(input, "click");
    Object.defineProperty(input, "showPicker", { configurable: true, value: undefined });

    fireEvent.click(screen.getByRole("button", { name: "选择日期，当前 2026-08-02" }));

    expect(click).toHaveBeenCalledOnce();
  });

  it("falls back to clicking the native input when showPicker rejects the request", () => {
    const { container } = render(<DateSelector mode="web" value="2026-08-02" onChange={vi.fn()} />);
    const input = container.querySelector('input[type="date"]') as HTMLInputElement & { showPicker?: () => void };
    const click = vi.spyOn(input, "click");
    input.showPicker = () => { throw new DOMException("not allowed"); };

    fireEvent.click(screen.getByRole("button", { name: "选择日期，当前 2026-08-02" }));

    expect(click).toHaveBeenCalledOnce();
  });
});
