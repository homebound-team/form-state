import { click, render, type } from "@homebound/rtl-utils";
import { fireEvent } from "@testing-library/react";
import React from "react";
import { FormStateApp } from "src/FormStateApp";

describe("FormStateApp", () => {
  it("save resets dirty reactively", async () => {
    const r = await render(<FormStateApp />);
    expect(r.firstName_dirty()).toHaveTextContent("false");

    type(r.firstName, "changed");
    expect(r.firstName_dirty()).toHaveTextContent("true");
    fireEvent.blur(r.firstName());
    expect(r.firstName_touched()).toHaveTextContent("true");

    click(r.commitChanges);
    expect(r.firstName_dirty()).toHaveTextContent("false");
    expect(r.firstName_touched()).toHaveTextContent("false");
  });

  it("originalValue is reactive", async () => {
    const r = await render(<FormStateApp />);
    expect(r.firstName_original()).toHaveTextContent("a1");
    click(r.set);
    click(r.commitChanges);
    expect(r.firstName_original()).toHaveTextContent("a2");
  });
});
