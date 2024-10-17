import { Meta } from "@storybook/react";
import { FormStateApp } from "src/FormStateApp";

export default {
  component: FormStateApp,
  title: "Components/Form State",
} as Meta;

export function AppExample() {
  return <FormStateApp />;
}
