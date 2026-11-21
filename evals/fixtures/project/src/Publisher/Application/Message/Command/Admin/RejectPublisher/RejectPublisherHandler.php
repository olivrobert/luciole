<?php

declare(strict_types=1);

namespace Publisher\Application\Message\Command\Admin\RejectPublisher;

use Common\Domain\Adapter\MailerInterface;
use Publisher\Domain\Event\PublisherStatusChanged;
use Publisher\Domain\Model\Publisher;
use Publisher\Domain\Notification\RegistrationRejectedEmail;
use Publisher\Domain\Repository\PublisherRepositoryInterface;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;
use Symfony\Component\Messenger\Envelope;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Messenger\Stamp\DispatchAfterCurrentBusStamp;

#[AsMessageHandler(bus: 'command.bus')]
readonly class RejectPublisherHandler
{
    public function __construct(
        private PublisherRepositoryInterface $publisherRepository,
        private MailerInterface $mailer,
        private MessageBusInterface $eventBus,
    ) {
    }

    public function __invoke(RejectPublisher $message): Publisher
    {
        $previousStatus = $message->publisher->accountStatus;
        $message->publisher->reject();

        $this->publisherRepository->save($message->publisher);

        $publisherId = $message->publisher->getId();
        \assert(null !== $publisherId);

        $this->eventBus->dispatch(
            (new Envelope(new PublisherStatusChanged($publisherId, $previousStatus, $message->publisher->accountStatus)))
                ->with(new DispatchAfterCurrentBusStamp()),
        );

        $this->mailer->send(new RegistrationRejectedEmail($message->publisher, $message->administrator, $message->comment));

        return $message->publisher;
    }
}
