<?php

declare(strict_types=1);

namespace Library\Application\Message\Command\Admin\ApproveLibrary;

use Common\Domain\Adapter\MailerInterface;
use Library\Application\Message\Query\GetRegionAdministrators\GetRegionAdministrators;
use Library\Domain\Event\LibraryApproved;
use Library\Domain\Model\Library;
use Library\Domain\Notification\RegistrationApprovedEmail;
use Library\Domain\Repository\LibraryRepositoryInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;
use Symfony\Component\Messenger\Envelope;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Messenger\Stamp\DispatchAfterCurrentBusStamp;
use Symfony\Component\Messenger\Stamp\HandledStamp;

#[AsMessageHandler(bus: 'command.bus')]
final readonly class ApproveLibraryHandler
{
    public function __construct(
        private LibraryRepositoryInterface $libraryRepository,
        private MailerInterface $mailer,
        #[Autowire(service: 'event.bus')]
        private MessageBusInterface $eventBus,
        #[Autowire(service: 'query.bus')]
        private MessageBusInterface $queryBus,
    ) {
    }

    public function __invoke(ApproveLibrary $command): Library
    {
        $library = $command->library;
        $library->approve($command->administrator);

        $this->libraryRepository->save($library);

        $libraryId = $library->getId();
        \assert(null !== $libraryId);

        $event = new LibraryApproved($libraryId);
        $envelope = (new Envelope($event))->with(new DispatchAfterCurrentBusStamp());
        $this->eventBus->dispatch($envelope);

        $this->notifyAdministrators($library);

        return $library;
    }

    private function notifyAdministrators(Library $library): void
    {
        $administrators = $this->queryBus
            ->dispatch(new GetRegionAdministrators($library->postalCode))
            ->last(HandledStamp::class)
            ?->getResult() ?? [];

        foreach ($administrators as $administrator) {
            $this->mailer->send(new RegistrationApprovedEmail($library, $administrator));
        }
    }
}
