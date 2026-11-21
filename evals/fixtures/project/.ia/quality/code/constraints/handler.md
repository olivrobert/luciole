---
paths:
  - "src/*/Application/Message/**/*Handler.php"
---

# Constraints — Messenger handlers (CQRS)

Scope: `src/*/Application/Message/**/*Handler.php` carrying `final readonly class suffixed Handler with #[AsMessageHandler], a single __invoke method`.

## Semantic Rules

- MUST: The AsMessageHandler attribute explicitly names the bus of the message family (command.bus, query.bus, event.bus). Trigger: handler class declaration. Anchor: #[AsMessageHandler(bus: '<family>.bus')] on the class, the family matching the Message/Command, Message/Query or Message/Event segment of the path. (69/69)
- MUST: The handler class is declared readonly. Trigger: handler class declaration. Anchor: readonly keyword before class, on the declaration line. (65/69)
- MUST: The handler only exposes __invoke: every helper method is private. Trigger: handler with helper methods besides __invoke. Anchor: private visibility on every method other than __construct and __invoke. (69/69)
- MUST: An injected MessageBusInterface is designated by an Autowire attribute naming the bus. Trigger: constructor receiving a MessageBusInterface. Anchor: #[Autowire(service: 'event.bus')] or #[Autowire(service: 'query.bus')] above the promoted parameter. (18/18)
- MUST: An event published from a handler is wrapped with a DispatchAfterCurrentBusStamp. Trigger: call to $this->eventBus->dispatch(). Anchor: (new Envelope($event))->with(new DispatchAfterCurrentBusStamp()). (15/15)
- MUST NOT: The handler does not depend on the EntityManager: persistence goes through a Domain repository interface. Trigger: handler that persists or removes an aggregate. Anchor: a constructor parameter typed <Context>\Domain\Repository\...RepositoryInterface, and no import of Doctrine\ORM. (68/69)
- MUST: The __invoke parameter is named after the message family: $command, $query or $event. Trigger: __invoke signature. Anchor: name of the single __invoke parameter. — coherence, non-blocking (69/69)
- MUST: A nullable value guaranteed by the context is narrowed with \assert, not with a technical exception. Trigger: reading a nullable identifier (getId()) the handler knows is set. Anchor: \assert(null !== $x); right after the assignment. (11/12)
- MUST: An unmet business precondition throws an exception from the context's Domain\Exception namespace. Trigger: handler rejecting a message for a business reason (duplicate, incomplete record…). Anchor: import and throw of a <Context>\Domain\Exception\...Exception class. (9/9)
- MUST: The handler shares its message's folder, a folder named after that message. Trigger: creation of a new use case (message + handler). Anchor: namespace ending with the message name, and __invoke parameter typed by that message without an import. — coherence, non-blocking (66/69)
