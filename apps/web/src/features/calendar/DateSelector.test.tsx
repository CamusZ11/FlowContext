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

  it("opens exactly seven local dates centered on the selected day", () => {
    render(<DateSelector mode="desktop" value="2026-08-05" onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "选择日期，当前 2026-08-05" }));

    expect(screen.getByRole("listbox", { name: "选择日期" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(7);
    expect(screen.getByRole("option", { name: "08 / 02 周日" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "08 / 05 周三" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "08 / 08 周六" })).toBeInTheDocument();
  });

  it("selects a date and closes the visual dropdown", () => {
    const onChange = vi.fn();
    render(<DateSelector mode="web" value="2026-08-05" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "选择日期，当前 2026-08-05" }));
    fireEvent.click(screen.getByRole("option", { name: "08 / 03 周一" }));

    expect(onChange).toHaveBeenCalledWith("2026-08-03");
    expect(screen.queryByRole("listbox", { name: "选择日期" })).not.toBeInTheDocument();
  });

  it("closes the visual dropdown on Escape or pointerdown outside", () => {
    render(<DateSelector mode="desktop" value="2026-08-05" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "选择日期，当前 2026-08-05" });

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "选择日期" })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox", { name: "选择日期" })).not.toBeInTheDocument();
  });
});
