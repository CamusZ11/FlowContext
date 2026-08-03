import { fireEvent, render, screen } from "@testing-library/react";
import { DateSelector } from "./DateSelector";

describe("DateSelector", () => {
  it("allows date selection in web mode", async () => {
    const onChange = vi.fn();
    render(<DateSelector mode="web" value="2026-08-02" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("选择日期"), { target: { value: "2026-08-05" } });
    expect(onChange).toHaveBeenCalledWith("2026-08-05");
  });

  it("does not render a date selector in desktop mode", () => {
    render(<DateSelector mode="desktop" value="2026-08-02" onChange={vi.fn()} />);
    expect(screen.queryByLabelText("选择日期")).not.toBeInTheDocument();
  });
});
