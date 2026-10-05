export type EventHandler<Event> = (event: Event) => boolean;

export class EventNode<Event> {
  private constructor(
    readonly name: string,
    readonly parent: EventNode<Event> | null,
    private readonly handle?: EventHandler<Event>,
  ) {}

  static root<Event>(handle: EventHandler<Event>): EventNode<Event> {
    return new EventNode("Root", null, handle);
  }

  child(name: string, handle?: EventHandler<Event>): EventNode<Event> {
    return new EventNode(name, this, handle);
  }

  bubble(event: Event): boolean {
    for (let node: EventNode<Event> | null = this; node; node = node.parent) {
      if (node.handle?.(event) === true) return true;
    }
    return false;
  }
}
