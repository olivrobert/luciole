<?php

declare(strict_types=1);

namespace Editeur\Application\Message\Command\Admin\RefuserEditeur;

use Common\Domain\Adapter\MailerInterface;
use Editeur\Domain\Event\EditeurStatutChange;
use Editeur\Domain\Model\Editeur;
use Editeur\Domain\Notification\RefusInscriptionEmail;
use Editeur\Domain\Repository\EditeurRepositoryInterface;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;
use Symfony\Component\Messenger\Envelope;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Messenger\Stamp\DispatchAfterCurrentBusStamp;

#[AsMessageHandler(bus: 'command.bus')]
readonly class RefuserEditeurHandler
{
    public function __construct(
        private EditeurRepositoryInterface $editeurRepository,
        private MailerInterface $mailer,
        private MessageBusInterface $eventBus,
    ) {
    }

    public function __invoke(RefuserEditeur $message): Editeur
    {
        $ancienStatut = $message->editeur->statutCompte;
        $message->editeur->refuser();

        $this->editeurRepository->save($message->editeur);

        $editeurId = $message->editeur->getId();
        \assert(null !== $editeurId);

        $this->eventBus->dispatch(
            (new Envelope(new EditeurStatutChange($editeurId, $ancienStatut, $message->editeur->statutCompte)))
                ->with(new DispatchAfterCurrentBusStamp()),
        );

        $this->mailer->send(new RefusInscriptionEmail($message->editeur, $message->administrateur, $message->commentaire));

        return $message->editeur;
    }
}
