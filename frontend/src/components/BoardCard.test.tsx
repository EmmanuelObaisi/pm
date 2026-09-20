import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CardFace } from "@/components/BoardCard";
import { makeCard, makeLabel } from "@/test/factories";

const labels = [
  makeLabel({ id: 50, name: "Bug", color: "#ef4444" }),
  makeLabel({ id: 51, name: "Feature", color: "#3b82f6" }),
];

describe("CardFace", () => {
  it("shows just the title for a bare card", () => {
    render(<CardFace card={makeCard({ title: "Write the spec" })} labels={labels} />);

    expect(screen.getByText("Write the spec")).toBeInTheDocument();
    expect(screen.getByText("medium")).toBeInTheDocument();
    expect(screen.queryByText("Bug")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Checklist progress")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Comments")).not.toBeInTheDocument();
  });

  it("shows the details when there are any", () => {
    render(
      <CardFace card={makeCard({ details: "Cover the API surface" })} labels={labels} />
    );
    expect(screen.getByText("Cover the API surface")).toBeInTheDocument();
  });

  it("shows only the labels the card carries", () => {
    render(<CardFace card={makeCard({ label_ids: [51] })} labels={labels} />);

    expect(screen.getByText("Feature")).toBeInTheDocument();
    expect(screen.queryByText("Bug")).not.toBeInTheDocument();
  });

  it("shows the priority", () => {
    render(<CardFace card={makeCard({ priority: "urgent" })} labels={labels} />);
    expect(screen.getByText("urgent")).toBeInTheDocument();
  });

  it("marks a future due date as due", () => {
    render(<CardFace card={makeCard({ due_date: "2099-01-01" })} labels={labels} />);
    expect(screen.getByText(/^Due /)).toBeInTheDocument();
  });

  it("marks a past due date as overdue", () => {
    render(<CardFace card={makeCard({ due_date: "2020-01-01" })} labels={labels} />);
    expect(screen.getByText(/^Overdue /)).toBeInTheDocument();
  });

  it("does not call an archived card overdue", () => {
    render(
      <CardFace
        card={makeCard({ due_date: "2020-01-01", archived: true })}
        labels={labels}
      />
    );
    expect(screen.getByText(/^Due /)).toBeInTheDocument();
  });

  it("shows checklist progress, comments, and the estimate", () => {
    render(
      <CardFace
        card={makeCard({
          checklist_done: 1,
          checklist_total: 3,
          comment_count: 2,
          estimate: 4.5,
        })}
        labels={labels}
      />
    );

    expect(screen.getByLabelText("Checklist progress")).toHaveTextContent("1/3");
    expect(screen.getByLabelText("Comments")).toHaveTextContent("2 comments");
    expect(screen.getByText("4.5h")).toBeInTheDocument();
  });

  it("shows the assignee when the card has one", () => {
    render(
      <CardFace
        card={makeCard({ assignee_id: 2, assignee_username: "bob" })}
        labels={labels}
      />
    );
    expect(screen.getByText("bob")).toBeInTheDocument();
  });

  it("renders a dragging card", () => {
    render(<CardFace card={makeCard({ title: "In flight" })} labels={labels} dragging />);
    expect(screen.getByText("In flight")).toBeInTheDocument();
  });
});
