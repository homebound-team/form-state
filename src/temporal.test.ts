import { Temporal } from "temporal-polyfill";
import { f } from "src/configBuilders";
import { createObjectState } from "src/fields/objectField";
import { type InternalSetOpts } from "src/fields/valueField";

describe("Temporal support", () => {
  it("treats equal Temporal value fields as unchanged", () => {
    const form = createObjectState(temporalValueConfig, {
      publishedOn: Temporal.PlainDate.from("2026-04-17"),
      scheduledAt: Temporal.ZonedDateTime.from("2026-04-17T09:00:00-04:00[America/New_York]"),
    });

    form.publishedOn.set(Temporal.PlainDate.from("2026-04-17"));
    form.scheduledAt.set(Temporal.ZonedDateTime.from("2026-04-17T09:00:00-04:00[America/New_York]"));

    expect(form.publishedOn.dirty).toBe(false);
    expect(form.scheduledAt.dirty).toBe(false);
    expect(form.dirty).toBe(false);
  });

  it("tracks dirty nested object fields with Temporal values", () => {
    const form = createObjectState(temporalObjectConfig, {
      details: {
        dueOn: Temporal.PlainDate.from("2026-04-17"),
        startsAt: Temporal.ZonedDateTime.from("2026-04-17T09:00:00-04:00[America/New_York]"),
      },
    });

    form.details.dueOn.set(Temporal.PlainDate.from("2026-04-17"));
    form.details.startsAt.set(Temporal.ZonedDateTime.from("2026-04-17T09:00:00-04:00[America/New_York]"));

    expect(form.details.dirty).toBe(false);
    expect(form.dirty).toBe(false);

    form.details.startsAt.set(Temporal.ZonedDateTime.from("2026-04-18T09:00:00-04:00[America/New_York]"));

    expect(form.details.startsAt.dirty).toBe(true);
    expect(form.details.dirty).toBe(true);
    expect(form.dirty).toBe(true);

    form.details.revertChanges();

    expect(form.details.startsAt.dirty).toBe(false);
    expect(form.details.dirty).toBe(false);
    expect(form.dirty).toBe(false);
  });

  it("supports list row hashing for Temporal.ZonedDateTime values", () => {
    const form = createObjectState(temporalListConfig, { events: [], milestones: [] });

    expect(() => {
      form.events.add({ startsAt: Temporal.ZonedDateTime.from("2026-04-17T09:00:00-04:00[America/New_York]") });
    }).not.toThrow();
    expect(form.events.dirty).toBe(true);

    const ackedRow = {
      id: "event:1",
      startsAt: Temporal.ZonedDateTime.from("2026-04-17T09:00:00-04:00[America/New_York]"),
    };
    expect(() => form.set({ events: [ackedRow] }, { refreshing: true } as InternalSetOpts)).not.toThrow();

    expect(form.events.dirty).toBe(false);
    expect(form.events.value[0].id).toEqual("event:1");
    expect(form.events.rows[0].startsAt.value?.equals(ackedRow.startsAt)).toBe(true);

    form.events.rows[0].startsAt.set(Temporal.ZonedDateTime.from("2026-04-18T09:00:00-04:00[America/New_York]"));

    expect(form.events.rows[0].startsAt.dirty).toBe(true);
    expect(form.events.dirty).toBe(true);
    expect(() => form.events.remove(0)).not.toThrow();
    expect(form.events.value).toEqual([]);
  });

  it("supports list row hashing for Temporal.PlainDate values", () => {
    const form = createObjectState(temporalListConfig, { events: [], milestones: [] });

    expect(() => {
      form.milestones.add({ dueOn: Temporal.PlainDate.from("2026-04-17") });
    }).not.toThrow();
    expect(form.milestones.dirty).toBe(true);

    const ackedRow = { id: "milestone:1", dueOn: Temporal.PlainDate.from("2026-04-17") };
    expect(() => form.set({ milestones: [ackedRow] }, { refreshing: true } as InternalSetOpts)).not.toThrow();

    expect(form.milestones.dirty).toBe(false);
    expect(form.milestones.value[0].id).toEqual("milestone:1");
    expect(form.milestones.rows[0].dueOn.value?.equals(ackedRow.dueOn)).toBe(true);

    form.milestones.rows[0].dueOn.set(Temporal.PlainDate.from("2026-04-18"));

    expect(form.milestones.rows[0].dueOn.dirty).toBe(true);
    expect(form.milestones.dirty).toBe(true);
    expect(() => form.milestones.remove(0)).not.toThrow();
    expect(form.milestones.value).toEqual([]);
  });
});

type TemporalValueForm = {
  publishedOn?: Temporal.PlainDate;
  scheduledAt?: Temporal.ZonedDateTime;
};

type TemporalObjectForm = {
  details: {
    dueOn?: Temporal.PlainDate;
    startsAt?: Temporal.ZonedDateTime;
  };
};

type TemporalListForm = {
  events: { id?: string; startsAt?: Temporal.ZonedDateTime }[];
  milestones: { id?: string; dueOn?: Temporal.PlainDate }[];
};

const temporalValueConfig = f.config<TemporalValueForm>({
  publishedOn: f.value(),
  scheduledAt: f.value(),
});

const temporalObjectConfig = f.config<TemporalObjectForm>({
  details: f.object({
    dueOn: f.value(),
    startsAt: f.value(),
  }),
});

const temporalListConfig = f.config<TemporalListForm>({
  events: f.list({
    id: f.value(),
    startsAt: f.value(),
  }),
  milestones: f.list({
    id: f.value(),
    dueOn: f.value(),
  }),
});
