<?php

declare(strict_types=1);

namespace Fonds\Application\Message\Command\Notice\ImporterNotice;

use Fonds\Domain\Adapter\CatalogueNationalInterface;
use Fonds\Domain\Event\NoticeImportee;
use Fonds\Domain\Exception\IsbnDejaCatalogueException;
use Fonds\Domain\Model\Ouvrage;
use Fonds\Domain\Repository\OuvrageRepositoryInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;
use Symfony\Component\Messenger\Envelope;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Messenger\Stamp\DispatchAfterCurrentBusStamp;

#[AsMessageHandler(bus: 'command.bus')]
final readonly class ImporterNoticeHandler
{
    public function __construct(
        private OuvrageRepositoryInterface $ouvrageRepository,
        private CatalogueNationalInterface $catalogueNational,
        #[Autowire(service: 'event.bus')]
        private MessageBusInterface $eventBus,
    ) {
    }

    public function __invoke(ImporterNotice $command): Ouvrage
    {
        if (null !== $this->ouvrageRepository->findByIsbn($command->isbn)) {
            throw new IsbnDejaCatalogueException($command->isbn);
        }

        $notice = $this->catalogueNational->fetch($command->isbn);
        $ouvrage = Ouvrage::fromNotice($notice);

        $this->ouvrageRepository->save($ouvrage);

        $ouvrageId = $ouvrage->getId();
        if (null === $ouvrageId) {
            throw new \LogicException('Ouvrage sans identifiant après enregistrement.');
        }

        $this->eventBus->dispatch(
            (new Envelope(new NoticeImportee($ouvrageId)))->with(new DispatchAfterCurrentBusStamp()),
        );

        return $ouvrage;
    }
}
