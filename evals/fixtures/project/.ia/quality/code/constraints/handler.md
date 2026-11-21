---
paths:
  - "src/*/Application/Message/**/*Handler.php"
---

# Constraints — Handlers Messenger (CQRS)

Scope: `src/*/Application/Message/**/*Handler.php` carrying `classe finale readonly suffixée Handler avec #[AsMessageHandler], unique méthode __invoke`.

## Semantic Rules

- MUST: L'attribut AsMessageHandler nomme explicitement le bus de la famille du message (command.bus, query.bus, event.bus). Trigger: déclaration de la classe handler. Anchor: #[AsMessageHandler(bus: '<famille>.bus')] au niveau de la classe, la famille correspondant au segment Message/Command, Message/Query ou Message/Event du chemin. (69/69)
- MUST: La classe handler est déclarée readonly. Trigger: déclaration de la classe handler. Anchor: mot-clé readonly devant class, sur la ligne de déclaration. (65/69)
- MUST: Le handler n'expose que __invoke : toute méthode d'appui est privée. Trigger: handler comportant des méthodes d'appui en plus de __invoke. Anchor: visibilité private sur toute méthode autre que __construct et __invoke. (69/69)
- MUST: Un MessageBusInterface injecté est désigné par un attribut Autowire nommant le bus. Trigger: constructeur recevant un MessageBusInterface. Anchor: #[Autowire(service: 'event.bus')] ou #[Autowire(service: 'query.bus')] au-dessus du paramètre promu. (18/18)
- MUST: Un événement publié depuis un handler est enveloppé avec un DispatchAfterCurrentBusStamp. Trigger: appel à $this->eventBus->dispatch(). Anchor: (new Envelope($event))->with(new DispatchAfterCurrentBusStamp()). (15/15)
- MUST NOT: Le handler ne dépend pas de l'EntityManager : la persistance passe par une interface de repository du Domain. Trigger: handler qui persiste ou supprime un agrégat. Anchor: un paramètre constructeur typé <Contexte>\Domain\Repository\...RepositoryInterface, et aucun import de Doctrine\ORM. (68/69)
- MUST: Le paramètre de __invoke est nommé d'après la famille du message : $command, $query ou $event. Trigger: signature de __invoke. Anchor: nom du paramètre unique de __invoke. — coherence, non-blocking (69/69)
- MUST: Une valeur nullable garantie par le contexte est rétrécie par \assert, pas par une exception technique. Trigger: lecture d'un identifiant nullable (getId()) dont le handler sait qu'il est renseigné. Anchor: \assert(null !== $x); immédiatement après l'affectation. (11/12)
- MUST: Une précondition métier non satisfaite lève une exception du namespace Domain\Exception du contexte. Trigger: handler qui refuse un message pour une raison métier (doublon, fiche incomplète…). Anchor: import et levée d'une classe <Contexte>\Domain\Exception\...Exception. (9/9)
- MUST: Le handler partage le dossier de son message, dossier nommé d'après ce message. Trigger: création d'un nouveau cas d'usage (message + handler). Anchor: namespace se terminant par le nom du message, et paramètre de __invoke typé par ce message sans import. — coherence, non-blocking (66/69)
