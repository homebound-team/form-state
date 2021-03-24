import { render } from "@testing-library/react";
import React from "react";
import { FormStateApp } from "src/FormStateApp";

describe("FormStateApp", () => {
  it("save resets dirty reactively", async () => {
    const { getByTestId } = render(<FormStateApp />);
    expect(getByTestId("firstName_dirty")).toHaveTextContent("false");

    // type(firstName, "changed");
    // expect(firstName_dirty()).toHaveTextContent("true");
    // fireEvent.blur(firstName());
    // expect(firstName_touched()).toHaveTextContent("true");

    // click(save);
    // expect(firstName_dirty()).toHaveTextContent("false");
    // expect(firstName_touched()).toHaveTextContent("false");
  });

  it("originalValue is reactive", async () => {
    // const { firstName_original, set, save } = await render(<FormStateApp />);
    // expect(firstName_original()).toHaveTextContent("a1");
    // click(set);
    // click(save);
    // expect(firstName_original()).toHaveTextContent("a2");
  });
});
